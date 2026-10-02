'use strict';

// The page of one creation: /gallery/:tid
define('forum/gallery-item', ['api', 'alerts', 'helpers', 'hooks'], function (api, alerts, helpers, hooks) {
	const Item = {};
	const PROMPT_COLLAPSED = 220; // px

	Item.init = function () {
		const root = $('.bina-creation');
		const data = ajaxify.data;
		const tid = String(data.tid);

		renderPrompt(root, data.prompt || '');
		renderComments(root, data.comments || []);

		root.on('click', '.bgc-like', function () { toggleLike($(this)); });
		root.on('click', '.bgc-follow', function () { toggleFollow($(this)); });
		root.on('click', '.bgc-copy', () => copy(data.prompt || '', 'הפרומפט הועתק.'));
		root.on('click', '.bgc-copy-link', () => copy(`${window.location.origin}${config.relative_path}/gallery/${tid}`, 'הקישור הועתק.'));
		root.on('click', '.bgc-edit', () => hooks.fire('action:composer.post.edit', { pid: data.pid }));
		root.on('click', '.bgc-prompt__more', function () {
			root.find('.bgc-prompt').addClass('is-open');
			$(this).prop('hidden', true);
		});
		root.on('submit', '.bgc-reply', function (e) {
			e.preventDefault();
			sendReply(root, tid, $(this));
		});
		// Ctrl+Enter (⌘+Enter on Mac) sends, like the forum's composer
		root.on('keydown', '.bgc-reply textarea', function (e) {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				$(this).closest('form').trigger('submit');
			}
		});

		// Arrow keys move between creations (not while typing)
		$(document).off('keydown.binaCreation').on('keydown.binaCreation', (e) => {
			if (e.altKey || e.ctrlKey || e.metaKey || $(e.target).is('input, textarea, select, [contenteditable]') ||
				$('.modal.show, .composer.reply').length) {
				return;
			}
			const link = e.key === 'ArrowRight' ? root.find('.bgc-nav--newer') :
				e.key === 'ArrowLeft' ? root.find('.bgc-nav--older') : null;
			if (link && link.length) {
				ajaxify.go(link.attr('href').replace(new RegExp(`^${config.relative_path}/`), ''));
			}
		});

		// Live updates: a new comment, or an edit of the creation itself.
		// Edits are sent to the topic's room, like on the topic page.
		app.enterRoom(`topic_${tid}`);
		const onNewPost = (payload) => {
			const post = payload && payload.posts && payload.posts[0];
			if (post && String(post.tid) === tid) {
				reloadComments(root, tid);
			}
		};
		const onEdited = (payload) => {
			if (payload && payload.post && String(payload.post.pid) === String(data.pid)) {
				ajaxify.refresh();
			}
		};
		socket.on('event:new_post', onNewPost);
		socket.on('event:post_edited', onEdited);
		$(window).one('action:ajaxify.start', () => {
			socket.removeListener('event:new_post', onNewPost);
			socket.removeListener('event:post_edited', onEdited);
			$(document).off('keydown.binaCreation');
		});
	};

	function renderPrompt(root, prompt) {
		const box = root.find('.bgc-prompt__text');
		if (!box.length) {
			return;
		}
		box.text(prompt);
		if (box[0].scrollHeight > PROMPT_COLLAPSED + 40) {
			root.find('.bgc-prompt').addClass('is-long');
			root.find('.bgc-prompt__more').prop('hidden', false);
		}
	}

	function renderComments(root, comments) {
		const list = root.find('.bgc-comments__list').empty();
		root.find('.bgc-comments__count').text(comments.length);
		if (!comments.length) {
			list.append('<li class="bgc-comments__empty">עוד אין תגובות. מה דעתכם על היצירה?</li>');
			return;
		}
		comments.forEach((c) => {
			const li = $('<li class="bgc-comment"></li>').attr('data-pid', c.pid);
			const profile = `${config.relative_path}/user/${c.user.userslug}`;
			$('<a class="bgc-comment__avatar"></a>').attr('href', profile).html(helpers.buildAvatar(c.user, '32px', true)).appendTo(li);
			const body = $('<div class="bgc-comment__body"></div>').appendTo(li);
			const head = $('<div class="bgc-comment__head"></div>').appendTo(body);
			// displayname comes escaped from the server, like everywhere in NodeBB
			$('<a class="bgc-comment__name"></a>').attr('href', profile).html(c.user.displayname).appendTo(head);
			$('<a class="bgc-comment__time timeago"></a>').attr({ title: c.timestampISO, href: `${config.relative_path}/post/${c.pid}` }).appendTo(head);
			// post content is sanitized HTML from the forum's own parser
			$('<div class="bgc-comment__content"></div>').html(c.content).appendTo(body);
			list.append(li);
		});
		list.find('.timeago').timeago();
	}

	async function reloadComments(root, tid) {
		try {
			const res = await fetch(`${config.relative_path}/api/gallery/${tid}`, { credentials: 'same-origin' });
			if (res.ok) {
				const fresh = await res.json();
				renderComments(root, fresh.comments || []);
			}
		} catch (e) { /* keep what is shown */ }
	}

	async function sendReply(root, tid, form) {
		const textarea = form.find('textarea');
		const content = String(textarea.val() || '').trim();
		if (!content) {
			return textarea.trigger('focus');
		}
		const button = form.find('.bgc-reply__send').prop('disabled', true);
		try {
			const result = await api.post(`/topics/${tid}`, { content });
			textarea.val('');
			if (result && result.queued) {
				alerts.success('התגובה נשלחה, ותופיע אחרי אישור.', 5000);
			} else {
				await reloadComments(root, tid);
				const last = root.find('.bgc-comment').last()[0];
				if (last) {
					last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
				}
			}
		} catch (err) {
			alerts.error(err);
		} finally {
			button.prop('disabled', false);
		}
	}

	async function toggleLike(btn) {
		if (!app.user.uid) {
			return ajaxify.go('login');
		}
		const liked = btn.attr('data-upvoted') === 'true';
		const pid = btn.attr('data-pid');
		btn.prop('disabled', true);
		try {
			if (liked) {
				await api.del(`/posts/${pid}/vote`, {});
			} else {
				await api.put(`/posts/${pid}/vote`, { delta: 1 });
			}
			const votes = (parseInt(btn.attr('data-votes'), 10) || 0) + (liked ? -1 : 1);
			btn.attr({ 'data-upvoted': String(!liked), 'data-votes': votes, 'aria-pressed': String(!liked) })
				.toggleClass('is-liked', !liked);
			btn.find('i').toggleClass('fa-solid', !liked).toggleClass('fa-regular', liked);
			btn.find('.bgc-like__count').text(votes);
		} catch (err) {
			alerts.error(err);
		} finally {
			btn.prop('disabled', false);
		}
	}

	async function toggleFollow(btn) {
		const following = btn.hasClass('is-following');
		const uid = btn.attr('data-uid');
		btn.prop('disabled', true);
		try {
			if (following) {
				await api.del(`/users/${uid}/follow`, {});
			} else {
				await api.put(`/users/${uid}/follow`, {});
			}
			btn.toggleClass('is-following', !following).attr('aria-pressed', String(!following));
		} catch (err) {
			alerts.error(err);
		} finally {
			btn.prop('disabled', false);
		}
	}

	async function copy(text, done) {
		try {
			await navigator.clipboard.writeText(text);
			alerts.success(done, 2000);
		} catch (err) {
			alerts.error('לא הצלחתי להעתיק. אפשר לסמן ולהעתיק ידנית.');
		}
	}

	return Item;
});
