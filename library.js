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
 */

const nodebb = require.main;
const winston = nodebb.require('winston');

const db = nodebb.require('./src/database');
const meta = nodebb.require('./src/meta');
const user = nodebb.require('./src/user');
const groups = nodebb.require('./src/groups');
const topics = nodebb.require('./src/topics');
const posts = nodebb.require('./src/posts');
const categories = nodebb.require('./src/categories');
const privileges = nodebb.require('./src/privileges');
const routeHelpers = nodebb.require('./src/routes/helpers');

const SETTINGS_KEY = 'bina-gallery';
const LOG = '[plugins/bina-gallery]';
const PAGE_SIZE = 24;
const MAX_SCAN = 2000;
const SCORES_KEY = 'bina-gallery:scores';        // sorted set: uid -> creator score (net likes on creations)
const CREATIONS_KEY = 'bina-gallery:creations';  // sorted set: uid -> number of creations
const LEADERBOARD_SIZE = 50;

const SORTS = [
	{ key: 'new', label: 'חדשות' },
	{ key: 'day', label: 'הכי אהובות היום', seconds: 86400 },
	{ key: 'week', label: 'השבוע', seconds: 7 * 86400 },
	{ key: 'month', label: 'החודש', seconds: 30 * 86400 },
	{ key: 'all', label: 'כל הזמנים' },
	{ key: 'creators', label: 'יוצרים מובילים', icon: 'fa-trophy' },
];

const plugin = {};

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

plugin.init = async ({ router }) => {
	routeHelpers.setupPageRoute(router, '/gallery', renderGallery);

	// First run: build the creator scores from whatever is already in the gallery
	if (!await db.exists(SCORES_KEY) && !await db.exists(CREATIONS_KEY)) {
		rebuildScores().catch(err => winston.error(`${LOG} ${err.stack}`));
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
	routeHelpers.setupApiRoute(router, 'post', '/bina-gallery/rebuild', [middleware.ensureLoggedIn], async (req, res) => {
		if (!await user.isAdministrator(req.uid)) {
			return helpers.formatApiResponse(403, res, new Error('[[error:no-privileges]]'));
		}
		helpers.formatApiResponse(200, res, await rebuildScores());
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
plugin.shouldQueue = async (payload) => {
	try {
		const { uid, data } = payload;
		if (payload.shouldQueue || !data || data.tid) {
			return payload;
		}
		const settings = await getSettings();
		if (!settings.moderation || !settings.cid || parseInt(data.cid, 10) !== settings.cid) {
			return payload;
		}
		const [isPrivileged, isApproved] = await Promise.all([
			user.isPrivileged(uid),
			settings.approvedGroup ? groups.isMember(uid, settings.approvedGroup) : false,
		]);
		if (!isPrivileged && !isApproved) {
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

plugin.onTopicMove = async ({ tid, fromCid, toCid }) => {
	try {
		const { cid } = await getSettings();
		if (parseInt(fromCid, 10) === cid || parseInt(toCid, 10) === cid) {
			await recountUser(await topics.getTopicField(tid, 'uid'));
		}
	} catch (err) {
		winston.error(`${LOG} ${err.stack}`);
	}
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

async function getCandidateTids(cid, sort) {
	const sortDef = SORTS.find(s => s.key === sort) || SORTS[0];
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
	const { tids: allTids, byVotes } = await getCandidateTids(cid, sort);
	const tids = await privileges.topics.filterTids('topics:read', allTids, uid);
	let list = await topics.getTopicsByTids(tids, uid);
	list = list.filter(t => t && !t.deleted && !t.pinned && t.thumbs && t.thumbs.length);
	if (byVotes) {
		list = list.filter(t => (parseInt(t.votes, 10) || 0) > 0)
			.sort((a, b) => (b.votes - a.votes) || (b.timestamp - a.timestamp));
	}
	return list;
}

function toItem(t, voteStatus, idx) {
	return {
		tid: t.tid,
		slug: t.slug,
		title: t.title,
		image: t.thumbs[0].url,
		pid: t.mainPid,
		votes: parseInt(t.votes, 10) || 0,
		replies: Math.max((parseInt(t.postcount, 10) || 1) - 1, 0),
		upvoted: !!(voteStatus && voteStatus.upvotes[idx]),
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

async function toItems(list, uid) {
	const voteStatus = uid > 0 ?
		await posts.getVoteStatusByPostIDs(list.map(t => t.mainPid), uid) : null;
	return list.map((t, i) => toItem(t, voteStatus, i));
}

async function renderGallery(req, res, next) {
	const settings = await getSettings();
	if (!settings.cid || !await categories.exists(settings.cid)) {
		return next();
	}
	const sort = SORTS.some(s => s.key === req.query.sort) ? req.query.sort : 'new';
	const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
	const sortsData = SORTS.map(s => ({
		key: s.key,
		label: s.label,
		icon: s.icon || '',
		active: s.key === sort,
		url: s.key === 'new' ? '/gallery' : `/gallery?sort=${s.key}`,
	}));

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
			loggedIn: req.uid > 0,
		});
	}

	const [list, canPost, category] = await Promise.all([
		getGalleryItems(req.uid, settings.cid, sort),
		privileges.categories.can('topics:create', settings.cid, req.uid),
		categories.getCategoryFields(settings.cid, ['cid', 'name', 'slug']),
	]);
	const start = (page - 1) * PAGE_SIZE;
	const items = await toItems(list.slice(start, start + PAGE_SIZE), req.uid);

	// "Creation of the day" – most liked creation from the last 24 hours, on the first page only
	let featured = null;
	if (page === 1 && sort === 'new') {
		const day = await getGalleryItems(req.uid, settings.cid, 'day');
		if (day.length) {
			[featured] = await toItems(day.slice(0, 1), req.uid);
		}
	}

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
		total: list.length,
		page,
		hasMore: start + PAGE_SIZE < list.length,
		nextPage: page + 1,
		cid: settings.cid,
		category,
		canPost,
		moderation: settings.moderation,
		loggedIn: req.uid > 0,
	});
}

module.exports = plugin;
