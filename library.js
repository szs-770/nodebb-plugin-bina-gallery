'use strict';

/*
 * nodebb-plugin-bina-gallery
 *
 * A gallery page (/gallery) for AI creations. It is built on top of a normal forum category:
 * every topic in that category is one creation, and its first image is the picture shown in the
 * gallery. Comments, likes (upvotes on the first post), notifications, moderation and search all
 * keep working exactly like the rest of the forum.
 *
 * Optional moderation: new creations wait in the post queue until a moderator approves them,
 * unless the author is privileged or a member of the "approved creators" group.
 *
 * Creator score: likes on creations (the first post of a gallery topic) are kept out of the forum
 * reputation and counted in a separate "creator score" instead, shown on the gallery leaderboard
 * and on the user's profile. Likes on comments keep counting towards reputation as usual.
 *
 * Separate from the forum: creations are kept out of the forum's topic lists (recent, unread and
 * its counter, popular/top, RSS, the home page cards and the parent category tile). They are
 * still shown in the gallery, in the gallery category itself and in search.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const nodebb = require.main;
const winston = nodebb.require('winston');
const nconf = nodebb.require('nconf');

const db = nodebb.require('./src/database');
const meta = nodebb.require('./src/meta');
const user = nodebb.require('./src/user');
const groups = nodebb.require('./src/groups');
const topics = nodebb.require('./src/topics');
const posts = nodebb.require('./src/posts');
const categories = nodebb.require('./src/categories');
const privileges = nodebb.require('./src/privileges');
const routeHelpers = nodebb.require('./src/routes/helpers');
const helpers = nodebb.require('./src/controllers/helpers');
const validator = nodebb.require('validator');

const SETTINGS_KEY = 'bina-gallery';
const LOG = '[plugins/bina-gallery]';
const PAGE_SIZE = 24;
const MAX_SCAN = 2000;
const SCORES_KEY = 'bina-gallery:scores';        // sorted set: uid -> creator score (net likes on creations)
const CREATIONS_KEY = 'bina-gallery:creations';  // sorted set: uid -> number of creations
const LEADERBOARD_SIZE = 50;
const THUMB_DIR = 'bina-gallery';   // inside the uploads folder
const GRID_WIDTH = 600;             // grid cards
const FEATURED_WIDTH = 1400;        // "creation of the day" banner
const THUMB_WIDTHS = [GRID_WIDTH, FEATURED_WIDTH];
const THUMBS_SET = tid => `bina-gallery:thumbs:${tid}`;   // set: thumbnail file names made for a topic
const THUMBS_INDEXED_KEY = 'bina-gallery:thumbs:indexed';

const SORTS = [
	{ key: 'new', label: 'חדשות' },
	{ key: 'day', label: 'הכי אהובות היום', seconds: 86400 },
	{ key: 'week', label: 'השבוע', seconds: 7 * 86400 },
	{ key: 'month', label: 'החודש', seconds: 30 * 86400 },
	{ key: 'all', label: 'כל הזמנים' },
	{ key: 'following', label: 'יוצרים שאני עוקב', icon: 'fa-user-group', loggedIn: true },
	{ key: 'creators', label: 'יוצרים מובילים', icon: 'fa-trophy' },
];

const plugin = {};

const _uniq = list => Array.from(new Set(list.map(String)));

/* ------------------------------------------------------------ settings */

async function getSettings() {
	const s = await meta.settings.get(SETTINGS_KEY);
	return {
		cid: parseInt(s.cid, 10) || 0,
		moderation: !['off', 'false', false, '0', 0].includes(s.moderation),
		approvedGroup: String(s.approvedGroup || 'יוצרים מאושרים').trim(),
	};
}

/* --------------------------------------------------------------- setup */

plugin.init = async ({ router, middleware }) => {
	routeHelpers.setupPageRoute(router, '/gallery', renderGallery);
	routeHelpers.setupPageRoute(router, '/gallery/:tid', renderCreation);
	// A creation's forum topic opens its gallery page. Plugin routes run before core's, and anything
	// that is not a creation simply continues to the regular topic page.
	router.get([
		'/topic/:topic_id/:slug?/:post_index?',
		'/api/topic/:topic_id/:slug?/:post_index?',
	], redirectCreationTopic);
	// "Gallery" tab in user profiles, with the same middlewares core uses for the other profile pages
	routeHelpers.setupPageRoute(router, '/user/:userslug/gallery', [
		middleware.exposeUid,
		middleware.canViewUsers,
		middleware.buildAccountData,
	], renderProfileGallery);

	// First run: build the creator scores from whatever is already in the gallery
	if (!await db.exists(SCORES_KEY) && !await db.exists(CREATIONS_KEY)) {
		rebuildScores().catch(err => winston.error(`${LOG} ${err.stack}`));
	}

	removeGalleryFromRecent().catch(err => winston.error(`${LOG} ${err.stack}`));
	indexExistingThumbs().catch(err => winston.error(`${LOG} ${err.stack}`));
	if (!await db.exists('bina-gallery:fields:synced')) {
		syncAllFields()
			.then(count => db.set('bina-gallery:fields:synced', Date.now())
				.then(() => winston.info(`${LOG} creation details read from ${count} creations`)))
			.catch(err => winston.error(`${LOG} ${err.stack}`));
	}

	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/bina-gallery', async (req, res) => {
		const settings = await getSettings();
		const cats = await categories.getAllCategoryFields(['cid', 'name', 'disabled', 'link']);
		const groupExists = settings.approvedGroup ? await groups.exists(settings.approvedGroup) : false;
		res.render('admin/plugins/bina-gallery', {
			title: 'גלריית יצירות',
			categories: cats.filter(c => c && !c.link && !c.disabled)
				.map(c => ({ cid: c.cid, name: c.name, selected: c.cid === settings.cid })),
			groupExists,
			groupSlug: groupExists ? await groups.getGroupField(settings.approvedGroup, 'slug') : '',
		});
	});
};

plugin.addRoutes = async ({ router, middleware, helpers }) => {
	// Details of one creation for the lightbox (the prompt can be long, so it is loaded on demand)
	routeHelpers.setupApiRoute(router, 'get', '/bina-gallery/items/:tid', [], async (req, res) => {
		const tid = parseInt(req.params.tid, 10);
		const { cid } = await getSettings();
		const topic = tid > 0 ? await topics.getTopicFields(tid, ['tid', 'cid', 'deleted', 'bgTool', 'bgStyles', 'bgPrompt']) : null;
		if (!topic || !topic.tid || parseInt(topic.cid, 10) !== cid || topic.deleted ||
			!await privileges.topics.can('topics:read', tid, req.uid)) {
			return helpers.formatApiResponse(404, res);
		}
		helpers.formatApiResponse(200, res, {
			tid,
			tool: topic.bgTool || '',
			styles: parseStyles(topic.bgStyles),
			prompt: topic.bgPrompt || '',
		});
	});

	routeHelpers.setupApiRoute(router, 'post', '/bina-gallery/rebuild', [middleware.ensureLoggedIn], async (req, res) => {
		if (!await user.isAdministrator(req.uid)) {
			return helpers.formatApiResponse(403, res, new Error('[[error:no-privileges]]'));
		}
		const scores = await rebuildScores();
		helpers.formatApiResponse(200, res, { ...scores, creations: await syncAllFields() });
	});
};

plugin.addAdminNavigation = (header) => {
	header.plugins.push({
		route: '/plugins/bina-gallery',
		icon: 'fa-images',
		name: 'גלריית יצירות',
	});
	return header;
};

plugin.appendConfig = async (config) => {
	const { cid } = await getSettings();
	config.binaGallery = { cid };
	return config;
};

/* ---------------------------------------------------------- moderation */

// New creations (new topics in the gallery category) go to the post queue when moderation is on,
// unless the author is an admin/moderator or a member of the approved creators group.
// Comments on creations are not affected.
async function needsApproval(uid, settings) {
	if (!settings.moderation) {
		return false;
	}
	const [isPrivileged, isApproved] = await Promise.all([
		user.isPrivileged(uid),
		settings.approvedGroup ? groups.isMember(uid, settings.approvedGroup) : false,
	]);
	return !isPrivileged && !isApproved;
}

plugin.shouldQueue = async (payload) => {
	try {
		const { uid, data } = payload;
		if (payload.shouldQueue || !data || data.tid) {
			return payload;
		}
		const settings = await getSettings();
		if (!settings.cid || parseInt(data.cid, 10) !== settings.cid) {
			return payload;
		}
		if (await needsApproval(uid, settings)) {
			payload.shouldQueue = true;
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
	return payload;
};

/* -------------------------------------------------------- creator score */

// Is this post the first post ("the creation") of a topic in the gallery category?
async function isCreationPost(pid) {
	const { cid } = await getSettings();
	if (!cid) {
		return false;
	}
	const tid = await posts.getPostField(pid, 'tid');
	if (!tid) {
		return false;
	}
	const topic = await topics.getTopicFields(tid, ['cid', 'mainPid']);
	return parseInt(topic.cid, 10) === cid && String(topic.mainPid) === String(pid);
}

// Core changes the owner's reputation by exactly one point for every vote hook it fires:
//   action:post.upvote   -> +1
//   action:post.downvote -> -1
//   action:post.unvote   -> -1 when an upvote was removed, +1 when a downvote was removed
// For creations we move that point from the reputation to the creator score.
async function onVote(delta, { pid, owner }) {
	try {
		owner = parseInt(owner, 10);
		if (!(owner > 0) || !await isCreationPost(pid)) {
			return;
		}
		await user.incrementUserReputationBy(owner, -delta);
		await recountUser(owner);
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
}

plugin.onUpvote = data => onVote(1, data);
plugin.onDownvote = data => onVote(-1, data);
plugin.onUnvote = data => onVote(data.current === 'upvote' ? -1 : 1, data);

// Creator score and creation count of one user, computed from their non-deleted creations.
// Only first posts of topics in the gallery category count; likes on comments do not.
async function computeUser(cid, uid) {
	const tids = await db.getSortedSetRange(`cid:${cid}:uid:${uid}:tids`, 0, -1);
	const list = (await db.getObjectsFields(tids.map(tid => `topic:${tid}`), ['mainPid', 'deleted']))
		.filter(t => t && t.mainPid && parseInt(t.deleted, 10) !== 1);
	const votes = await db.getObjectsFields(list.map(t => `post:${t.mainPid}`), ['upvotes', 'downvotes']);
	const score = votes.reduce((sum, v) => sum + ((parseInt(v.upvotes, 10) || 0) - (parseInt(v.downvotes, 10) || 0)), 0);
	return { score, creations: list.length };
}

async function recountUser(uid) {
	uid = parseInt(uid, 10);
	const { cid } = await getSettings();
	if (!(uid > 0) || !cid) {
		return;
	}
	const { score, creations } = await computeUser(cid, uid);
	await Promise.all([
		creations ? db.sortedSetAdd(SCORES_KEY, score, uid) : db.sortedSetRemove(SCORES_KEY, uid),
		creations ? db.sortedSetAdd(CREATIONS_KEY, creations, uid) : db.sortedSetRemove(CREATIONS_KEY, uid),
	]);
}

plugin.onTopicChange = async ({ topic }) => {
	try {
		const { cid } = await getSettings();
		if (topic && parseInt(topic.cid, 10) === cid) {
			await recountUser(topic.uid);
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
};

// A deleted or purged creation must not stay reachable through its gallery thumbnails
// (e.g. a picture removed for modesty reasons). Restoring it simply recreates them on the next view.
plugin.onTopicRemoved = async (hookData) => {
	await plugin.onTopicChange(hookData);
	try {
		const { cid } = await getSettings();
		const { topic } = hookData;
		if (topic && topic.tid && parseInt(topic.cid, 10) === cid) {
			await deleteThumbs(topic.tid);
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
};

plugin.onTopicMove = async ({ tid, fromCid, toCid }) => {
	try {
		const { cid } = await getSettings();
		fromCid = parseInt(fromCid, 10);
		toCid = parseInt(toCid, 10);
		if (!cid || fromCid === toCid || (fromCid !== cid && toCid !== cid)) {
			return;
		}
		await recountUser(await topics.getTopicField(tid, 'uid'));
		if (toCid === cid) {
			// moved into the gallery: out of the forum lists
			await db.sortedSetRemove('topics:recent', tid);
			await syncFields(tid);
		} else {
			// moved out of the gallery: back into the forum lists (core only does this for /world moves)
			await topics.updateRecent(tid, await topics.getTopicField(tid, 'lastposttime'));
			await deleteThumbs(tid);
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
};

/* ------------------------------------------------- creation details */

// The tool, styles and prompt of a creation are written in its first post with fixed labels
// (the gallery's upload window writes them, and the old composer template used the same labels):
//   **הכלי / המודל:** Midjourney
//   **סגנונות:** צבעי מים, פנטזיה
//   **הפרומפט:**
//   ```
//   a fox in the snow ...
//   ```
// They are copied into topic fields (bgTool, bgStyles, bgPrompt) whenever the creation is posted
// (also after approval from the post queue), edited or moved into the gallery, so the gallery can
// show and later filter by them. The post itself stays the single source of truth.
const MAX_TOOL = 200;
const MAX_STYLE = 40;
const MAX_STYLES = 5;
const MAX_PROMPT = 10000;
const LABELS = {
	'הכלי / המודל': 'tool',
	'הכלי': 'tool',
	'סגנונות': 'styles',
	'סגנון': 'styles',
	'הפרומפט': 'prompt',
	'אישור שימוש': 'usage',
	'שימוש': 'usage',
};

// Usage permission the creator chose for the picture (topic 333). The post holds the Hebrew text;
// the field holds the key. No choice (older creations) means nothing was said.
const USAGE = {
	none: 'שימוש רק באישור היוצר',
	personal: 'מאשר שימוש אישי',
	commercial: 'מאשר שימוש אישי ומסחרי',
};

function usageKey(text) {
	const line = String(text || '').split('\n')[0];
	if (/(^|[\s(])(לא|אסור)(?=$|[\s,.)])|רק באישור/.test(line)) {
		return 'none';
	}
	if (/מסחרי/.test(line)) {
		return 'commercial';
	}
	if (/אישי/.test(line)) {
		return 'personal';
	}
	return '';
}
const LABEL_RE = new RegExp(`\\*\\*\\s*(${Object.keys(LABELS).map(l => l.replace(/[/]/g, '\\/')).join('|')})\\s*:?\\s*\\*\\*\\s*:?`, 'g');

const FENCED_RE = /^[ \t]*\n?[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?[ \t]*\1[ \t]*(?:\n|$)/;

function parseCreation(content) {
	const out = { tool: '', styles: [], prompt: '', usage: '' };
	if (typeof content !== 'string') {
		return out;
	}
	const marks = [];
	let m;
	LABEL_RE.lastIndex = 0;
	while ((m = LABEL_RE.exec(content))) {
		marks.push({ key: LABELS[m[1]], start: m.index, end: LABEL_RE.lastIndex });
	}
	let skipUntil = -1;
	marks.forEach((mark, i) => {
		if (mark.start < skipUntil) {
			return; // a label written inside a fenced prompt is part of the prompt
		}
		let value;
		const fenced = mark.key === 'prompt' ? FENCED_RE.exec(content.slice(mark.end)) : null;
		if (fenced) {
			value = fenced[2];
			skipUntil = mark.end + fenced[0].length;
		} else {
			const next = marks.slice(i + 1).find(n => n.start >= skipUntil);
			value = content.slice(mark.end, next ? next.start : content.length);
		}
		value = value.trim();
		if (!value || (out[mark.key] && out[mark.key].length)) {
			return; // first non-empty value of each label wins
		}
		if (mark.key === 'tool') {
			out.tool = value.split('\n')
				.map(line => line.trim().replace(/\s*:$/, ''))
				.filter(Boolean)
				.join(' · ')
				.slice(0, MAX_TOOL);
		} else if (mark.key === 'usage') {
			out.usage = usageKey(value);
		} else if (mark.key === 'styles') {
			out.styles = value.split('\n')[0].split(/[,،]/)
				.map(st => st.trim().slice(0, MAX_STYLE))
				.filter(Boolean)
				.slice(0, MAX_STYLES);
		} else {
			let prompt = value;
			if (/^"[\s\S]*"$/.test(prompt) && !prompt.slice(1, -1).includes('"')) {
				prompt = prompt.slice(1, -1).trim();
			}
			out.prompt = prompt.slice(0, MAX_PROMPT);
		}
	});
	return out;
}

async function syncFields(tid) {
	const { cid } = await getSettings();
	const topic = await topics.getTopicFields(tid, ['cid', 'mainPid']);
	if (!cid || !topic || parseInt(topic.cid, 10) !== cid || !topic.mainPid) {
		return;
	}
	const fields = parseCreation(await posts.getPostField(topic.mainPid, 'content'));
	const set = {};
	const remove = [];
	(fields.tool ? (set.bgTool = fields.tool) : remove.push('bgTool'));
	(fields.styles.length ? (set.bgStyles = JSON.stringify(fields.styles)) : remove.push('bgStyles'));
	(fields.prompt ? (set.bgPrompt = fields.prompt) : remove.push('bgPrompt'));
	(fields.usage ? (set.bgUsage = fields.usage) : remove.push('bgUsage'));
	if (Object.keys(set).length) {
		await db.setObject(`topic:${tid}`, set);
	}
	if (remove.length) {
		await db.deleteObjectFields(`topic:${tid}`, remove);
	}
}

function parseStyles(json) {
	try {
		const list = JSON.parse(json || '[]');
		return Array.isArray(list) ? list.map(String) : [];
	} catch (e) {
		return [];
	}
}

plugin.onTopicPost = async (hookData) => {
	await plugin.onTopicChange(hookData);
	try {
		const { topic } = hookData;
		if (topic && topic.tid) {
			await syncFields(topic.tid);
			// the creator's last choice is offered again in the next upload
			const usage = await topics.getTopicField(topic.tid, 'bgUsage');
			if (usage && USAGE[usage] && parseInt(topic.uid, 10) > 0) {
				await user.setUserField(topic.uid, 'binaGalleryUsage', usage);
			}
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
};

plugin.onPostEdit = async ({ post }) => {
	try {
		if (!post || !post.tid || !post.pid) {
			return;
		}
		const mainPid = await topics.getTopicField(post.tid, 'mainPid');
		if (String(mainPid) === String(post.pid)) {
			await syncFields(post.tid);
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
};

// One-time (and admin button): fill the fields of creations posted before 1.5.0
async function syncAllFields() {
	const { cid } = await getSettings();
	if (!cid) {
		return 0;
	}
	const tids = await db.getSortedSetRange(`cid:${cid}:tids:create`, 0, -1);
	for (const tid of tids) {
		await syncFields(tid); // eslint-disable-line no-await-in-loop
	}
	return tids.length;
}

/* ------------------------------------------- out of the forum's topic lists */

async function isGalleryTopic(tid) {
	const { cid } = await getSettings();
	return !!cid && parseInt(await topics.getTopicField(tid, 'cid'), 10) === cid;
}

async function getGalleryTidSet(tids) {
	const { cid } = await getSettings();
	if (!cid || !tids.length) {
		return new Set();
	}
	const data = await topics.getTopicsFields(tids, ['tid', 'cid']);
	return new Set(data.filter(t => t && parseInt(t.cid, 10) === cid).map(t => String(t.tid)));
}

function includesCid(list, cid) {
	if (list === undefined || list === null || list === '') {
		return false;
	}
	return (Array.isArray(list) ? list : [list]).map(String).includes(String(cid));
}

// topics:recent feeds /recent, the unread list of followed topics and the home page cards
plugin.filterUpdateRecent = async (data) => {
	try {
		if (data && data.tid && await isGalleryTopic(data.tid)) {
			return {};
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
	return data;
};

async function removeGalleryFromRecent() {
	const { cid } = await getSettings();
	if (!cid) {
		return;
	}
	const sets = [`cid:${cid}:tids`, `cid:${cid}:tids:pinned`, `cid:${cid}:tids:create`];
	const tids = _uniq((await Promise.all(sets.map(set => db.getSortedSetRange(set, 0, -1)))).flat());
	if (tids.length) {
		await db.sortedSetRemove('topics:recent', tids);
	}
}

// /recent, /popular, /top, their RSS feeds and the email digest.
// Kept when the gallery category is selected explicitly, and on tag pages.
plugin.filterSortedTids = async (data) => {
	try {
		const { cid } = await getSettings();
		const params = data.params || {};
		if (!cid || !data.tids || !data.tids.length ||
			includesCid(params.cids, cid) || (params.tags && params.tags.length)) {
			return data;
		}
		const gallery = await getGalleryTidSet(data.tids);
		if (gallery.size) {
			data.tids = data.tids.filter(tid => !gallery.has(String(tid)));
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
	return data;
};

// /unread and the unread counters in the menu. Kept when the gallery category is selected.
plugin.filterUnreadTids = async (data) => {
	try {
		const { cid } = await getSettings();
		if (!cid || !data || !data.tidsByFilter || includesCid(data.cid, cid)) {
			return data;
		}
		const all = _uniq(Object.values(data.tidsByFilter).flat());
		const gallery = await getGalleryTidSet(all);
		if (!gallery.size) {
			return data;
		}
		Object.keys(data.tidsByFilter).forEach((filter) => {
			data.tidsByFilter[filter] = data.tidsByFilter[filter].filter(tid => !gallery.has(String(tid)));
			if (data.counts && Object.hasOwn(data.counts, filter)) {
				data.counts[filter] = data.tidsByFilter[filter].length;
			}
		});
		data.tids = data.tidsByFilter[data.filter || ''] ||
			(data.tids || []).filter(tid => !gallery.has(String(tid)));
		if (Array.isArray(data.unreadCids)) {
			data.unreadCids = data.unreadCids.filter(c => String(c) !== String(cid));
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
	return data;
};

// Live updates: a new creation or comment still reaches open pages (so an open creation shows new
// comments right away), but must not bump the unread counters in the menu. The menu counter only
// counts posts of followed topics or watched/tracked categories, so mark it as neither.
// The "new topics" bar of topic lists is handled on the client (public/forum-lists.js).
plugin.onSendNewPostToUid = async (data) => {
	try {
		const { cid } = await getSettings();
		const post = data && data.post;
		if (cid && post && post.topic && parseInt(post.topic.cid, 10) === cid) {
			post.categoryWatchState = categories.watchStates.ignoring;
			post.topic.isFollowing = false;
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
	return data;
};

// Rebuild the creator scores and creation counts from the gallery category (admin button).
// Only the score is rebuilt – reputation is never touched here.
async function rebuildScores() {
	const { cid } = await getSettings();
	await db.deleteAll([SCORES_KEY, CREATIONS_KEY]);
	if (!cid) {
		return { creators: 0 };
	}
	const tids = await db.getSortedSetRange(`cid:${cid}:tids:create`, 0, -1);
	const owners = await db.getObjectsFields(tids.map(tid => `topic:${tid}`), ['uid']);
	const uids = Array.from(new Set(owners.map(t => parseInt(t && t.uid, 10)).filter(uid => uid > 0)));
	for (const uid of uids) {
		// eslint-disable-next-line no-await-in-loop
		await recountUser(uid);
	}
	return { creators: await db.sortedSetCard(CREATIONS_KEY) };
}

async function getLeaderboard() {
	const rows = await db.getSortedSetRevRangeWithScores(SCORES_KEY, 0, LEADERBOARD_SIZE * 2);
	const byUid = rows.filter(r => r.score > 0).slice(0, LEADERBOARD_SIZE);
	const uids = byUid.map(r => r.value);
	const [users, creations] = await Promise.all([
		user.getUsersFields(uids, ['uid', 'username', 'userslug', 'displayname', 'picture', 'icon:text', 'icon:bgColor', 'banned']),
		db.sortedSetScores(CREATIONS_KEY, uids),
	]);
	return byUid.map((r, i) => ({
		rank: i + 1,
		top3: i < 3,
		medal: ['🥇', '🥈', '🥉'][i] || '',
		score: r.score,
		creations: parseInt(creations[i], 10) || 0,
		user: users[i],
	})).filter(r => r.user && r.user.uid && !r.user.banned);
}

// Creator score on the profile (shown by public/profile.js when the user has creations)
plugin.addProfileData = async (hookData) => {
	try {
		const uid = hookData.userData && hookData.userData.uid;
		if (uid) {
			const [score, creations] = await Promise.all([
				db.sortedSetScore(SCORES_KEY, uid),
				db.sortedSetScore(CREATIONS_KEY, uid),
			]);
			hookData.userData.binaGallery = {
				score: parseInt(score, 10) || 0,
				creations: parseInt(creations, 10) || 0,
			};
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
	return hookData;
};

/* -------------------------------------------------------------- gallery */

async function getCandidateTids(cid, sort, uid) {
	const sortDef = SORTS.find(s => s.key === sort) || SORTS[0];
	if (sortDef.key === 'following') {
		// creations of the people this user follows, newest first
		const uids = uid > 0 ? await db.getSortedSetRange(`following:${uid}`, 0, -1) : [];
		const sets = uids.filter(u => parseInt(u, 10) > 0).map(u => `cid:${cid}:uid:${u}:tids`);
		return { tids: sets.length ? await db.getSortedSetRevRange(sets, 0, MAX_SCAN - 1) : [], byVotes: false };
	}
	if (sortDef.key === 'all') {
		return { tids: await db.getSortedSetRevRange(`cid:${cid}:tids:votes`, 0, MAX_SCAN - 1), byVotes: false };
	}
	if (sortDef.seconds) {
		const since = Date.now() - (sortDef.seconds * 1000);
		const tids = await db.getSortedSetRevRangeByScore(`cid:${cid}:tids:create`, 0, MAX_SCAN, '+inf', since);
		return { tids, byVotes: true };
	}
	return { tids: await db.getSortedSetRevRange(`cid:${cid}:tids:create`, 0, MAX_SCAN - 1), byVotes: false };
}

async function getGalleryItems(uid, cid, sort) {
	const { tids: allTids, byVotes } = await getCandidateTids(cid, sort, uid);
	const tids = await privileges.topics.filterTids('topics:read', allTids, uid);
	let list = await topics.getTopicsByTids(tids, uid);
	list = list.filter(t => t && !t.deleted && !t.pinned && t.thumbs && t.thumbs.length);
	if (byVotes) {
		list = list.filter(t => (parseInt(t.votes, 10) || 0) > 0)
			.sort((a, b) => (b.votes - a.votes) || (b.timestamp - a.timestamp));
	}
	return list;
}

/* ----------------------------------------------------------- thumbnails */

// The gallery grid shows small WebP copies of the images (the full image is only loaded in the
// lightbox). Copies are made on first view with sharp and stored in uploads/bina-gallery/.
// Anything that is not a local upload, or animated GIFs, is shown as is.
const pendingThumbs = new Map();

// File path of a local upload URL (inside the uploads folder), or null
function uploadFile(url) {
	const uploadUrl = `${nconf.get('relative_path')}${nconf.get('upload_url')}`;
	if (typeof url !== 'string' || !url.startsWith(`${uploadUrl}/`)) {
		return null;
	}
	let relative;
	try {
		relative = decodeURIComponent(url.slice(uploadUrl.length + 1).split('?')[0]);
	} catch (e) {
		return null;
	}
	const uploadPath = path.resolve(nconf.get('upload_path'));
	const file = path.resolve(uploadPath, relative);
	return file.startsWith(`${uploadPath}${path.sep}`) ? { file, relative } : null;
}

// Where the thumbnail of an uploaded image is stored, or null when the image is not a local upload
// (or is a GIF, which keeps its animation and is shown as is).
function thumbInfo(url, width) {
	const uploadUrl = `${nconf.get('relative_path')}${nconf.get('upload_url')}`;
	const local = uploadFile(url);
	if (!local || /\.gif$/i.test(local.file)) {
		return null;
	}
	const { file: source, relative } = local;
	const uploadPath = nconf.get('upload_path');
	const name = `${crypto.createHash('sha1').update(relative).digest('hex').slice(0, 20)}-${width}.webp`;
	return {
		name,
		source,
		target: path.join(uploadPath, THUMB_DIR, name),
		url: `${uploadUrl}/${THUMB_DIR}/${name}`,
	};
}

async function getThumb(url, width, tid) {
	const info = thumbInfo(url, width);
	if (!info) {
		return url;
	}
	const { source, target } = info;

	try {
		await fs.promises.access(target);
		return info.url;
	} catch (e) { /* not created yet */ }

	if (!pendingThumbs.has(target)) {
		pendingThumbs.set(target, (async () => {
			const sharp = nodebb.require('sharp');
			await fs.promises.mkdir(path.dirname(target), { recursive: true });
			const tmp = `${target}.${process.pid}.tmp`;
			await sharp(source, { failOn: 'none' })
				.rotate()
				.resize({ width, withoutEnlargement: true })
				.webp({ quality: 80 })
				.toFile(tmp);
			await fs.promises.rename(tmp, target);
			if (tid) {
				await db.setAdd(THUMBS_SET(tid), info.name);
			}
		})().finally(() => pendingThumbs.delete(target)));
	}
	try {
		await pendingThumbs.get(target);
		return info.url;
	} catch (err) {
		winston.warn(`${LOG} could not create a thumbnail for ${url}: ${err.message}`);
		return url;
	}
}

// Thumbnail file names of a topic's current images (all sizes), whether they exist or not
async function currentThumbNames(tid) {
	const topicData = await topics.getTopicData(tid);
	if (!topicData) {
		return [];
	}
	const [thumbs] = await topics.thumbs.load([topicData]);
	return (thumbs || []).flatMap(thumb => THUMB_WIDTHS.map(w => thumbInfo(thumb && thumb.url, w)))
		.filter(Boolean)
		.map(info => info.name);
}

async function deleteThumbs(tid) {
	const names = _uniq([
		...await db.getSetMembers(THUMBS_SET(tid)),
		...await currentThumbNames(tid),
	]);
	const dir = path.resolve(nconf.get('upload_path'), THUMB_DIR);
	await Promise.all(names.filter(name => /^[0-9a-f]{20}-\d+\.webp$/.test(name)).map(async (name) => {
		imageSizes.delete(path.join(dir, name));
		try {
			await fs.promises.unlink(path.join(dir, name));
		} catch (err) {
			if (err.code !== 'ENOENT') {
				throw err;
			}
		}
	}));
	await db.delete(THUMBS_SET(tid));
}

// Thumbnails made before 1.3.0 were not recorded per topic. Record them once, so that a later
// purge (when the topic data is already gone) can still remove them.
async function indexExistingThumbs() {
	const { cid } = await getSettings();
	if (!cid || await db.exists(THUMBS_INDEXED_KEY)) {
		return;
	}
	const dir = path.join(nconf.get('upload_path'), THUMB_DIR);
	const tids = await db.getSortedSetRange(`cid:${cid}:tids:create`, 0, -1);
	for (const tid of tids) {
		/* eslint-disable no-await-in-loop */
		const names = await currentThumbNames(tid);
		const existing = [];
		for (const name of names) {
			try {
				await fs.promises.access(path.join(dir, name));
				existing.push(name);
			} catch (e) { /* never made */ }
		}
		if (existing.length) {
			await db.setAdd(THUMBS_SET(tid), existing);
		}
		/* eslint-enable no-await-in-loop */
	}
	await db.set(THUMBS_INDEXED_KEY, Date.now());
}

// Display size (width/height) of a local image, so the grid can reserve the card's space before the
// image loads and place it in the right column. Read from the file header once, then cached.
const imageSizes = new Map();
const IMAGE_SIZES_MAX = 5000;

async function getImageSize(url) {
	const local = uploadFile(url);
	if (!local) {
		return null;
	}
	if (imageSizes.has(local.file)) {
		return imageSizes.get(local.file);
	}
	let size = null;
	try {
		const sharp = nodebb.require('sharp');
		const meta = await sharp(local.file, { failOn: 'none' }).metadata();
		if (meta.width > 0 && meta.height > 0) {
			// EXIF orientations 5–8 are rotated by 90°
			size = meta.orientation >= 5 ? { w: meta.height, h: meta.width } : { w: meta.width, h: meta.height };
			if (meta.pages > 1 && meta.pageHeight) {
				size.h = meta.pageHeight; // animated image: one frame
			}
		}
	} catch (err) {
		return null; // missing or unreadable file: not cached, try again next time
	}
	if (imageSizes.size >= IMAGE_SIZES_MAX) {
		imageSizes.clear();
	}
	imageSizes.set(local.file, size);
	return size;
}

// Forum titles may start with a topic type ("שיתוף | …", from the custom JS topic type selector).
// In the gallery the prefix is noise, so creations are shown without it (the topic keeps it).
// A title that is only a prefix gets the same default as a creation shared without a title.
const TYPE_PREFIX = /^\s*(?:שאלה|בירור|שיתוף|המלצה|מדריך|באג|להורדה|עדכון|דיון|סקר)\s*\|\s*/;
function displayTitle(topic) {
	const title = String(topic.title || '').replace(TYPE_PREFIX, '').trim();
	// displayname comes escaped, like the title
	return title || `יצירה של ${(topic.user && topic.user.displayname) || ''}`.trim();
}

// Comments per creation. topic.postcount also counts deleted replies (creation 319 showed 7, with 1
// visible), so count the replies (tid:<tid>:posts, without the main post) that are not deleted.
async function getReplyCounts(list) {
	const pidLists = await db.getSortedSetsMembers(list.map(t => `tid:${t.tid}:posts`));
	const all = pidLists.flat();
	const fields = all.length ? await db.getObjectsFields(all.map(pid => `post:${pid}`), ['deleted']) : [];
	const deleted = new Set(all.filter((pid, i) => fields[i] && parseInt(fields[i].deleted, 10) === 1).map(String));
	return pidLists.map(pids => pids.filter(pid => !deleted.has(String(pid))).length);
}

function toItem(t, voteStatus, idx) {
	return {
		tid: t.tid,
		slug: t.slug,
		title: displayTitle(t),
		image: t.thumbs[0].url,
		thumb: t.thumbs[0].url,
		pid: t.mainPid,
		votes: parseInt(t.votes, 10) || 0,
		replies: Math.max((parseInt(t.postcount, 10) || 1) - 1, 0),
		upvoted: !!(voteStatus && voteStatus.upvotes[idx]),
		// escaped like the title: templates print values as they are
		tool: validator.escape(String(t.bgTool || '')),
		styles: parseStyles(t.bgStyles).map(st => validator.escape(st)).join(', '),
		hasPrompt: !!t.bgPrompt,
		usage: USAGE[t.bgUsage] ? t.bgUsage : '',
		timestampISO: t.timestampISO,
		user: {
			uid: t.user.uid,
			username: t.user.username,
			displayname: t.user.displayname,
			userslug: t.user.userslug,
			picture: t.user.picture,
			'icon:text': t.user['icon:text'],
			'icon:bgColor': t.user['icon:bgColor'],
		},
	};
}

async function toItems(list, uid, width = GRID_WIDTH, start = 0) {
	const [voteStatus, thumbs, replies] = await Promise.all([
		uid > 0 ? posts.getVoteStatusByPostIDs(list.map(t => t.mainPid), uid) : null,
		Promise.all(list.map(t => getThumb(t.thumbs[0].url, width, t.tid))),
		getReplyCounts(list),
	]);
	const sizes = await Promise.all(thumbs.map(getImageSize));
	return list.map((t, i) => ({
		...toItem(t, voteStatus, i),
		replies: replies[i],
		thumb: thumbs[i],
		w: sizes[i] ? sizes[i].w : 0,
		h: sizes[i] ? sizes[i].h : 0,
		index: start + i,
	}));
}

/* -------------------------------------------------------------- filters */

// Tools are free text ("נייט קפה (מכוונן עדין)", "נייט קפה · SDXL 1.0"), so they are grouped by
// their first part: the text before " · ", "(", ":", "+", "," or a period.
function toolKey(tool) {
	return String(tool || '').split(/\s·\s|[(:+,]|\.\s|\.$/)[0].replace(/\s+/g, ' ').trim().toLowerCase();
}

function toolLabel(tool) {
	return String(tool || '').split(/\s·\s|[(:+,]|\.\s|\.$/)[0].replace(/\s+/g, ' ').trim();
}

// "נייט קפה Virtual Utopia XL" belongs to "נייט קפה" when that name is used on its own too
function toolGroups(list) {
	const keys = [...new Set(list.map(t => toolKey(t.bgTool)).filter(Boolean))].sort((a, b) => a.length - b.length);
	const groups = new Map();
	keys.forEach((key) => {
		const parent = keys.find(k => k.length < key.length && key.startsWith(`${k} `));
		groups.set(key, parent ? groups.get(parent) : key);
	});
	return groups;
}

function readFilters(query) {
	const one = v => (Array.isArray(v) ? v[0] : v);
	const clean = v => String(one(v) || '').trim().slice(0, 100);
	return {
		tool: clean(query.tool).toLowerCase(),
		style: clean(query.style),
		usage: USAGE[clean(query.usage)] ? clean(query.usage) : '',
	};
}

function hasFilters(f) {
	return !!(f.tool || f.style || f.usage);
}

function applyFilters(list, f, groups) {
	return list.filter(t => (!f.tool || (groups.get(toolKey(t.bgTool)) || toolKey(t.bgTool)) === f.tool) &&
		(!f.style || parseStyles(t.bgStyles).includes(f.style)) &&
		(!f.usage || t.bgUsage === f.usage ||
			// "personal use" also matches creations that allow commercial use
			(f.usage === 'personal' && t.bgUsage === 'commercial')));
}

function filterQuery(f) {
	const params = new URLSearchParams();
	['tool', 'style', 'usage'].forEach((k) => {
		if (f[k]) {
			params.set(k, f[k]);
		}
	});
	return params.toString();
}

// Options for the filter menus, counted over all visible creations
function getFacets(list, f, groups) {
	const tools = new Map();
	const styles = new Map();
	const labels = new Map(list.map(t => [toolKey(t.bgTool), toolLabel(t.bgTool)]));
	list.forEach((t) => {
		const key = groups.get(toolKey(t.bgTool));
		if (key) {
			const entry = tools.get(key) || { key, label: labels.get(key) || toolLabel(t.bgTool), count: 0 };
			entry.count += 1;
			tools.set(key, entry);
		}
		parseStyles(t.bgStyles).forEach(name => styles.set(name, (styles.get(name) || 0) + 1));
	});
	const esc = v => validator.escape(String(v));
	return {
		tools: [...tools.values()].sort((a, b) => b.count - a.count).slice(0, 15)
			.map(tl => ({ value: esc(tl.key), label: esc(tl.label), count: tl.count, selected: tl.key === f.tool })),
		styles: [...styles.entries()].sort((a, b) => b[1] - a[1])
			.map(([name, count]) => ({ value: esc(name), label: esc(name), count, selected: name === f.style })),
		usages: [
			{ value: 'commercial', label: 'מותר לשימוש מסחרי' },
			{ value: 'personal', label: 'מותר לשימוש אישי' },
			{ value: 'none', label: 'רק באישור היוצר' },
		].map(u => ({ ...u, selected: u.value === f.usage })),
	};
}

async function renderGallery(req, res, next) {
	const settings = await getSettings();
	if (!settings.cid || !await categories.exists(settings.cid)) {
		return next();
	}
	const loggedIn = req.uid > 0;
	const sort = SORTS.some(s => s.key === req.query.sort && (!s.loggedIn || loggedIn)) ? req.query.sort : 'new';
	const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
	const filters = readFilters(req.query);
	const fq = filterQuery(filters);
	const sortsData = SORTS.filter(s => !s.loggedIn || loggedIn).map((s) => {
		// the sorts keep the current filters (the leaderboard has none)
		const params = new URLSearchParams(s.key === 'creators' ? '' : fq);
		if (s.key !== 'new') {
			params.set('sort', s.key);
		}
		const qs = params.toString();
		return {
			key: s.key,
			label: s.label,
			icon: s.icon || '',
			active: s.key === sort,
			url: `/gallery${qs ? `?${qs}` : ''}`,
		};
	});

	if (sort === 'creators') {
		const [leaders, canPost, category] = await Promise.all([
			getLeaderboard(),
			privileges.categories.can('topics:create', settings.cid, req.uid),
			categories.getCategoryFields(settings.cid, ['cid', 'name', 'slug']),
		]);
		return res.render('gallery', {
			title: 'יוצרים מובילים | גלריית יצירות',
			breadcrumbs: [{ text: 'גלריית יצירות', url: '/gallery' }, { text: 'יוצרים מובילים' }],
			sort,
			sorts: sortsData,
			creatorsView: true,
			leaders,
			noLeaders: !leaders.length,
			items: [],
			cid: settings.cid,
			category,
			canPost,
			willQueue: canPost && req.uid > 0 ? await needsApproval(req.uid, settings) : false,
			lastUsage: canPost && req.uid > 0 && USAGE[await user.getUserField(req.uid, 'binaGalleryUsage')] ?
				await user.getUserField(req.uid, 'binaGalleryUsage') : '',
			loggedIn: req.uid > 0,
		});
	}

	const [sorted, everything, canPost, category] = await Promise.all([
		getGalleryItems(req.uid, settings.cid, sort),
		sort === 'new' ? null : getGalleryItems(req.uid, settings.cid, 'new'),
		privileges.categories.can('topics:create', settings.cid, req.uid),
		categories.getCategoryFields(settings.cid, ['cid', 'name', 'slug']),
	]);
	const groups = toolGroups(everything || sorted);
	const list = applyFilters(sorted, filters, groups);
	const facets = getFacets(everything || sorted, filters, groups);
	const start = (page - 1) * PAGE_SIZE;
	const items = await toItems(list.slice(start, start + PAGE_SIZE), req.uid, GRID_WIDTH, start);

	// "Creation of the day" – most liked creation from the last 24 hours, on the first page only
	let featured = null;
	if (page === 1 && sort === 'new' && !hasFilters(filters)) {
		const day = await getGalleryItems(req.uid, settings.cid, 'day');
		if (day.length) {
			[featured] = await toItems(day.slice(0, 1), req.uid, FEATURED_WIDTH);
		}
	}

	const willQueue = canPost && req.uid > 0 ? await needsApproval(req.uid, settings) : false;
	const lastUsage = canPost && req.uid > 0 ? await user.getUserField(req.uid, 'binaGalleryUsage') : '';

	// Sorts and filters are views of the same gallery: one canonical address for search engines
	res.locals.linkTags = [{ rel: 'canonical', href: `${nconf.get('url')}/gallery${page > 1 && sort === 'new' && !hasFilters(filters) ? `?page=${page}` : ''}` }];
	res.locals.metaTags = [
		{ name: 'description', content: 'גלריית יצירות ה-AI של חברי פורום בינה טופ: תמונות, הכלים והפרומפטים שמאחוריהן.' },
		{ property: 'og:description', content: 'גלריית יצירות ה-AI של חברי פורום בינה טופ: תמונות, הכלים והפרומפטים שמאחוריהן.' },
	];

	res.render('gallery', {
		title: 'גלריית יצירות',
		breadcrumbs: [{ text: 'גלריית יצירות' }],
		sort,
		sorts: sortsData,
		creatorsView: false,
		items,
		featured,
		hasFeatured: !!featured,
		empty: !items.length,
		emptyFollowing: !items.length && sort === 'following' && !hasFilters(filters),
		emptyFiltered: !items.length && hasFilters(filters),
		total: list.length,
		filters: { tool: validator.escape(filters.tool), style: validator.escape(filters.style), usage: filters.usage },
		filtered: hasFilters(filters),
		filterQuery: validator.escape(fq),
		clearUrl: sort === 'new' ? '/gallery' : `/gallery?sort=${sort}`,
		facets,
		hasToolFacet: facets.tools.length > 0,
		hasStyleFacet: facets.styles.length > 0,
		page,
		hasMore: start + PAGE_SIZE < list.length,
		nextPage: page + 1,
		cid: settings.cid,
		category,
		canPost,
		willQueue,
		lastUsage: USAGE[lastUsage] ? lastUsage : '',
		moderation: settings.moderation,
		loggedIn: req.uid > 0,
	});
}

/* -------------------------------------------------------- creation page */

const COMMENTS_MAX = 200;
const MORE_FROM_CREATOR = 6;

function absoluteUrl(url) {
	return /^https?:\/\//.test(url) ? url : `${nconf.get('url')}${url.startsWith(nconf.get('relative_path')) ? url.slice(nconf.get('relative_path').length) : url}`;
}

function textExcerpt(text, max) {
	const plain = String(text || '').replace(/\s+/g, ' ').trim();
	return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

// Comments: every post of the creation's topic except the first one, oldest first
async function getComments(tid, uid) {
	const pids = await db.getSortedSetRange(`tid:${tid}:posts`, 0, COMMENTS_MAX - 1);
	if (!pids.length) {
		return [];
	}
	const list = await posts.getPostSummaryByPids(pids, uid, { stripTags: false });
	return list.filter(p => p && !p.deleted).map(p => ({
		pid: p.pid,
		content: p.content,
		timestampISO: p.timestampISO,
		user: {
			uid: p.user.uid,
			username: p.user.username,
			displayname: p.user.displayname,
			userslug: p.user.userslug,
			picture: p.user.picture,
			'icon:text': p.user['icon:text'],
			'icon:bgColor': p.user['icon:bgColor'],
		},
	}));
}

async function renderCreation(req, res, next) {
	const tid = parseInt(req.params.tid, 10);
	const settings = await getSettings();
	if (!(tid > 0) || !settings.cid) {
		return next();
	}
	const [topic] = await topics.getTopicsByTids([tid], req.uid);
	if (!topic || parseInt(topic.cid, 10) !== settings.cid) {
		return next();
	}
	const [canRead, isPrivileged] = await Promise.all([
		privileges.topics.can('topics:read', tid, req.uid),
		user.isPrivileged(req.uid),
	]);
	if (!canRead) {
		return next(); // same answer as a missing page
	}
	if ((topic.deleted && !isPrivileged) || !topic.thumbs || !topic.thumbs.length) {
		// a creation without a picture (or a deleted one) is still a forum topic
		return helpers.redirect(res, `/topic/${topic.slug}`);
	}

	const authorUid = parseInt(topic.uid, 10);
	const [
		[item], comments, canReply, editState, isFollowing, score, creations, list, otherTids,
	] = await Promise.all([
		toItems([topic], req.uid, FEATURED_WIDTH),
		getComments(tid, req.uid),
		privileges.topics.can('topics:reply', tid, req.uid),
		req.uid > 0 ? privileges.posts.canEdit(topic.mainPid, req.uid) : { flag: false },
		req.uid > 0 && req.uid !== authorUid ? user.isFollowing(req.uid, authorUid) : false,
		db.sortedSetScore(SCORES_KEY, authorUid),
		db.sortedSetScore(CREATIONS_KEY, authorUid),
		getGalleryItems(req.uid, settings.cid, 'new'),
		db.getSortedSetRevRange(`cid:${settings.cid}:uid:${authorUid}:tids`, 0, 30),
	]);

	// Newer / older creation, in the order of the gallery
	const position = list.findIndex(t => String(t.tid) === String(tid));
	const newer = position > 0 ? list[position - 1] : null;
	const older = position >= 0 && position < list.length - 1 ? list[position + 1] : null;

	// More from the same creator
	const others = (await topics.getTopicsByTids(otherTids.filter(t => String(t) !== String(tid)), req.uid))
		.filter(t => t && !t.deleted && !t.pinned && t.thumbs && t.thumbs.length)
		.slice(0, MORE_FROM_CREATOR);
	const moreItems = await toItems(others, req.uid);

	const prompt = topic.bgPrompt || '';
	const usage = USAGE[topic.bgUsage] ? topic.bgUsage : '';
	const description = prompt ?
		textExcerpt(prompt, 200) :
		`יצירה של ${validator.unescape(String(item.user.displayname || ''))} בגלריית היצירות של בינה טופ`;

	res.locals.metaTags = [
		{ name: 'description', content: validator.escape(description) },
		{ property: 'og:title', content: item.title },
		{ property: 'og:description', content: validator.escape(description) },
		{ property: 'og:type', content: 'article' },
		{ property: 'og:image', content: absoluteUrl(item.thumb) },
		{ property: 'og:image:url', content: absoluteUrl(item.thumb) },
	];
	if (item.w && item.h) {
		res.locals.metaTags.push(
			{ property: 'og:image:width', content: String(item.w) },
			{ property: 'og:image:height', content: String(item.h) },
		);
	}
	res.locals.linkTags = [{ rel: 'canonical', href: `${nconf.get('url')}/gallery/${tid}` }];

	res.render('gallery-item', {
		title: item.title,
		breadcrumbs: [{ text: 'גלריית יצירות', url: '/gallery' }, { text: item.title }],
		item,
		image: item.image,
		tid,
		pid: topic.mainPid,
		slug: topic.slug,
		deleted: !!topic.deleted,
		timestampISO: topic.timestampISO,
		tool: validator.escape(String(topic.bgTool || '')),
		styles: parseStyles(topic.bgStyles).map(name => ({ name: validator.escape(name) })),
		hasStyles: parseStyles(topic.bgStyles).length > 0,
		prompt, // printed with text() on the client only
		hasPrompt: !!prompt,
		usage,
		usageText: usage ? { none: 'שימוש רק באישור היוצר', personal: 'מותר לשימוש אישי', commercial: 'מותר לשימוש אישי ומסחרי' }[usage] : '',
		usageIcon: usage ? { none: 'fa-lock', personal: 'fa-user-check', commercial: 'fa-circle-check' }[usage] : '',
		author: item.user,
		authorScore: parseInt(score, 10) || 0,
		authorCreations: parseInt(creations, 10) || 0,
		isFollowing: !!isFollowing,
		canFollow: req.uid > 0 && req.uid !== authorUid,
		isOwn: req.uid > 0 && req.uid === authorUid,
		canEdit: !!(editState && editState.flag),
		canReply,
		loggedIn: req.uid > 0,
		comments,
		commentCount: comments.length,
		newer: newer ? { tid: newer.tid, title: displayTitle(newer) } : null,
		older: older ? { tid: older.tid, title: displayTitle(older) } : null,
		position: position >= 0 ? position + 1 : 0,
		total: list.length,
		more: moreItems,
		hasMore: moreItems.length > 0,
		cid: settings.cid,
	});
}

/* ------------------------------------------- topic page -> creation page */

// The regular topic view stays available with ?raw=1 (moderation tools, the full thread),
// and for ActivityPub requests. Deleted creations and topics without a picture are not redirected
// (the creation page would send them back here).
async function redirectCreationTopic(req, res, next) {
	try {
		const tid = parseInt(req.params.topic_id, 10);
		const accept = String(req.get('accept') || '');
		if (!(tid > 0) || req.query.raw || /activity\+json|ld\+json/.test(accept)) {
			return next();
		}
		const { cid } = await getSettings();
		const topic = cid ? await topics.getTopicFields(tid, ['tid', 'cid', 'deleted', 'mainPid']) : null;
		if (!topic || !topic.tid || parseInt(topic.cid, 10) !== cid || topic.deleted) {
			return next();
		}
		const [thumbs] = await topics.thumbs.load([topic]);
		if (!thumbs || !thumbs.length) {
			return next();
		}
		res.locals.isAPI = res.locals.isAPI || req.path.startsWith('/api/');
		const anchor = req.params.post_index && parseInt(req.params.post_index, 10) > 1 ? '#comments' : '';
		return helpers.redirect(res, `/gallery/${tid}${anchor}`);
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
		return next();
	}
}

/* ------------------------------------------------------------- sitemap */

// Creations are listed in the sitemap by their gallery address (their /topic address redirects
// there), together with the gallery itself.
plugin.sitemapTopics = async (data) => {
	try {
		const { cid } = await getSettings();
		if (cid && data.topics && data.topics.length) {
			const cids = await topics.getTopicsFields(data.topics.map(t => t && t.tid), ['cid']);
			data.topics = data.topics.filter((t, i) => !cids[i] || parseInt(cids[i].cid, 10) !== cid);
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
	return data;
};

plugin.sitemapPages = async (data) => {
	try {
		const settings = await getSettings();
		if (!settings.cid) {
			return data;
		}
		const list = await getGalleryItems(0, settings.cid, 'new'); // what guests can see
		const rp = nconf.get('relative_path');
		data.urls.push({ url: `${rp}/gallery`, changefreq: 'daily', priority: 0.6 });
		list.forEach((t) => {
			data.urls.push({
				url: `${rp}/gallery/${t.tid}`,
				lastmodISO: new Date(parseInt(t.lastposttime, 10) || parseInt(t.timestamp, 10) || Date.now()).toISOString(),
				changefreq: 'weekly',
				priority: 0.5,
			});
		});
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
	return data;
};

/* ------------------------------------- forum profile lists without the gallery */

// Creations (and comments on them) have their own profile tab, so the regular "topics" and
// "posts" lists of a profile, and its main page, leave the gallery category out.
const PROFILE_LISTS = { 'account/topics': 'tids', 'account/posts': 'pids' };

plugin.filterAccountLists = async (hookData) => {
	const { req, template, userData, settings, data, start, stop } = hookData;
	let sets = await data.getSets(req.uid, userData);
	try {
		const { cid } = await getSettings();
		if (cid && PROFILE_LISTS[template]) {
			const skip = `cid:${cid}:uid:${userData.uid}:${PROFILE_LISTS[template]}`;
			sets = (Array.isArray(sets) ? sets : [sets]).filter(set => set !== skip);
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
	// the same as core does without this hook (controllers/accounts/posts.js)
	if (Array.isArray(sets) && !sets.length) {
		hookData.itemCount = 0;
		hookData.itemData = { [data.type]: [], nextStart: 0 };
		return hookData;
	}
	const count = async () => {
		if (!settings.usePagination) {
			return 0;
		}
		return data.getItemCount ? await data.getItemCount(sets) : await db.sortedSetsCardSum(sets);
	};
	const items = async () => {
		if (data.getTopics) {
			return await data.getTopics(sets, req, start, stop);
		}
		const method = data.type === 'topics' ? topics.getTopicsFromSet : posts.getPostSummariesFromSet;
		return await method(sets, req.uid, start, stop);
	};
	[hookData.itemCount, hookData.itemData] = await Promise.all([count(), items()]);
	return hookData;
};

plugin.filterProfilePids = async (hookData) => {
	try {
		const { cid } = await getSettings();
		if (cid && hookData.pids && hookData.pids.length) {
			const tids = (await posts.getPostsFields(hookData.pids, ['tid'])).map(p => p && p.tid);
			const cids = await topics.getTopicsFields(tids, ['cid']);
			hookData.pids = hookData.pids.filter((pid, i) => !cids[i] || parseInt(cids[i].cid, 10) !== cid);
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
	return hookData;
};

/* ----------------------------------------------------- profile gallery tab */

plugin.addProfileMenu = async (data) => {
	data.links.push({
		id: 'bina-gallery',
		route: 'gallery',
		icon: 'fa-images',
		name: 'יצירות בגלריה',
		visibility: {
			self: true,
			other: true,
			moderator: true,
			globalMod: true,
			admin: true,
		},
	});
	return data;
};

async function renderProfileGallery(req, res, next) {
	const settings = await getSettings();
	const userData = res.locals.userData;
	if (!settings.cid || !userData) {
		return next();
	}
	const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
	const allTids = await db.getSortedSetRevRange(`cid:${settings.cid}:uid:${userData.uid}:tids`, 0, MAX_SCAN - 1);
	const tids = await privileges.topics.filterTids('topics:read', allTids, req.uid);
	const list = (await topics.getTopicsByTids(tids, req.uid))
		.filter(t => t && !t.deleted && !t.pinned && t.thumbs && t.thumbs.length);
	const start = (page - 1) * PAGE_SIZE;
	const items = await toItems(list.slice(start, start + PAGE_SIZE), req.uid, GRID_WIDTH, start);
	const hearts = list.reduce((sum, t) => sum + Math.max(parseInt(t.votes, 10) || 0, 0), 0);

	res.render('account/gallery', {
		...userData,
		title: `יצירות בגלריה | ${userData.displayname}`,
		breadcrumbs: [{ text: userData.displayname, url: `/user/${userData.userslug}` }, { text: 'יצירות בגלריה' }],
		items,
		empty: !items.length,
		creationCount: list.length,
		hearts,
		hasMore: start + PAGE_SIZE < list.length,
		nextPage: page + 1,
		cid: settings.cid,
		canPost: userData.isSelf && await privileges.categories.can('topics:create', settings.cid, req.uid),
	});
}

module.exports = plugin;
