'use strict';

define('forum/gallery', ['api', 'alerts', 'helpers', 'bootbox'], function (api, alerts, helpers, bootbox) {
	const Gallery = {};

	// Suggestions only: any tool name can be typed
	const TOOLS = [
		'נייט קפה', 'ChatGPT / GPT Image', 'Gemini / ננו בננה', 'Midjourney', 'DALL·E', 'Stable Diffusion',
		'Flux', 'Ideogram', 'Leonardo', 'Krea', 'Copilot', 'Grok', 'Adobe Firefly',
	];
	const STYLES = [
		'צילום מציאותי', 'ציור שמן', 'צבעי מים', 'איור ספרי ילדים', 'אנימה', 'תלת־ממד',
		'פנטזיה', 'סוריאליסטי', 'מינימליסטי', 'פיקסל ארט', 'קומיקס', 'שחור־לבן',
	];
	const MAX_STYLES = 3;
	// Usage permission of the picture (topic 333). The text goes into the post, the server keeps the key.
	const USAGE = [
		{ key: 'none', icon: 'fa-lock', label: 'לא מאשר', text: 'שימוש רק באישור היוצר', hint: 'שימוש רק באישור ממני' },
		{ key: 'personal', icon: 'fa-user', label: 'שימוש אישי', text: 'מאשר שימוש אישי', hint: 'מותר להשתמש לצורך אישי' },
		{ key: 'commercial', icon: 'fa-briefcase', label: 'אישי ומסחרי', text: 'מאשר שימוש אישי ומסחרי', hint: 'מותר להשתמש גם לצורך מסחרי' },
	];
	const USAGE_SHOWN = {
		none: { icon: 'fa-lock', text: 'שימוש רק באישור היוצר' },
		personal: { icon: 'fa-user-check', text: 'מותר לשימוש אישי' },
		commercial: { icon: 'fa-circle-check', text: 'מותר לשימוש אישי ומסחרי' },
	};
	const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

	let lightbox = null;
	let current = -1;
	const details = new Map(); // tid -> { tool, styles, prompt } loaded for the lightbox

	Gallery.init = function () {
		const root = $('.bina-gallery');

		root.on('click', '.bg-share', function () {
			openUpload(parseInt($(this).attr('data-cid'), 10), $(this).attr('data-will-queue') === 'true', $(this).attr('data-last-usage') || '');
		});

		root.on('click', '.bg-open', function (e) {
			if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) {
				return;
			}
			// ajaxify handles every link click on the page, so stop the event here
			e.preventDefault();
			e.stopPropagation();
			const cards = orderedCards(root);
			openLightbox(cards, cards.index(this));
		});

		root.on('click', '.bg-load-more', loadMore);

		masonry.init(root.find('.bg-grid'));

		$(window).one('action:ajaxify.start', () => {
			closeLightbox();
			masonry.destroy();
		});
	};

	// Cards in their real order (the order of the list), not the order of the columns:
	// "creation of the day" first, then the grid by data-index. Used by the lightbox and its keys.
	function orderedCards(root) {
		const grid = root.find('.bg-grid .bg-card').toArray()
			.sort((a, b) => (parseInt(a.dataset.index, 10) || 0) - (parseInt(b.dataset.index, 10) || 0));
		return $(root.find('.bg-featured').toArray().concat(grid));
	}

	/* -------------------------------------------------------- masonry */

	// Each card goes, in order, into the column that is currently the shortest (ties: the first
	// column, which is the rightmost in RTL). So the newest creations always fill the top row.
	// Card heights are known before the images load, from the width/height attributes the server adds.
	// The layout is rebuilt only when the number of columns changes; "load more" only adds cards.
	const masonry = {
		grid: null,
		cols: [],
		count: 0,
		onResize: null,

		init(grid) {
			this.destroy();
			if (!grid.length) {
				return;
			}
			this.grid = grid;
			this.layout();
			let frame = 0;
			this.onResize = () => {
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(() => {
					if (this.grid && this.columnCount() !== this.count) {
						this.layout();
					}
				});
			};
			window.addEventListener('resize', this.onResize);
		},

		destroy() {
			if (this.onResize) {
				window.removeEventListener('resize', this.onResize);
			}
			this.grid = null;
			this.cols = [];
			this.count = 0;
			this.onResize = null;
		},

		columnCount() {
			const n = parseInt(getComputedStyle(this.grid[0]).getPropertyValue('--bg-cols'), 10);
			return n > 0 ? n : 1;
		},

		layout() {
			const grid = this.grid;
			const cards = grid.find('.bg-card').toArray()
				.sort((a, b) => (parseInt(a.dataset.index, 10) || 0) - (parseInt(b.dataset.index, 10) || 0));
			this.count = this.columnCount();
			grid.find('.bg-col').remove();
			this.cols = [];
			for (let i = 0; i < this.count; i += 1) {
				this.cols.push($('<div class="bg-col"></div>').appendTo(grid)[0]);
			}
			grid.addClass('bg-grid--masonry');
			this.add(cards);
		},

		add(cards) {
			if (!this.grid) {
				return;
			}
			cards.forEach((card) => {
				let target = this.cols[0];
				let min = Infinity;
				this.cols.forEach((col) => {
					const height = col.getBoundingClientRect().height;
					if (height < min - 0.5) {
						min = height;
						target = col;
					}
				});
				target.appendChild(card);
			});
		},
	};

	/* --------------------------------------------------- upload window */

	// The gallery's own upload window: a picture, an optional title, the tool, up to three styles and
	// the prompt. It uploads the picture with the forum's regular upload and creates the topic with
	// the regular API, so permissions, the post queue, rate limits and EXIF removal all apply as usual.
	// The details are written into the post with fixed labels; the server reads them from there.
	function openUpload(cid, willQueue, lastUsage) {
		let file = null;
		let previewUrl = null;
		const maxKb = parseInt(config.maximumFileSize, 10) || 0;

		const form = $(`
			<form class="bg-upload" novalidate>
				<label class="bg-upload__drop" tabindex="0">
					<input type="file" class="bg-upload__file" accept="${IMAGE_TYPES.join(',')}" hidden>
					<span class="bg-upload__empty">
						<i class="fa-solid fa-cloud-arrow-up"></i>
						<span class="bg-upload__hint">גררו לכאן תמונה, הדביקו אותה, או לחצו לבחירה</span>
						<small>PNG, JPG, WEBP או GIF${maxKb ? ` · עד ${formatSize(maxKb * 1024)}` : ''}</small>
					</span>
					<img class="bg-upload__preview" alt="" hidden>
				</label>
				<div class="mb-3">
					<label class="form-label" for="bg-upload-title">כותרת <span class="text-secondary fw-normal">(לא חובה)</span></label>
					<input type="text" class="form-control" id="bg-upload-title" name="title" maxlength="${parseInt(config.maximumTitleLength, 10) || 255}">
				</div>
				<div class="mb-3">
					<label class="form-label" for="bg-upload-tool">הכלי / המודל</label>
					<input type="text" class="form-control" id="bg-upload-tool" name="tool" maxlength="200" list="bg-upload-tools" placeholder="למשל: Midjourney" autocomplete="off">
					<datalist id="bg-upload-tools"></datalist>
				</div>
				<div class="mb-3">
					<div class="form-label">סגנון <span class="text-secondary fw-normal">(עד ${MAX_STYLES}, לא חובה)</span></div>
					<div class="bg-upload__styles"></div>
				</div>
				<div class="mb-3">
					<label class="form-label" for="bg-upload-prompt">הפרומפט <span class="text-secondary fw-normal">(לא חובה)</span></label>
					<textarea class="form-control" id="bg-upload-prompt" name="prompt" rows="4" maxlength="10000" dir="auto"></textarea>
				</div>
				<fieldset class="bg-upload__usage">
					<legend class="form-label">אישור שימוש בתמונה</legend>
					<div class="bg-upload__usage-options" role="radiogroup">
						${USAGE.map(u => `
							<label class="bg-upload__usage-option">
								<input type="radio" name="usage" value="${u.key}" ${u.key === lastUsage ? 'checked' : ''}>
								<span><i class="fa-solid ${u.icon}"></i> <b>${u.label}</b><small>${u.hint}</small></span>
							</label>`).join('')}
					</div>
				</fieldset>
				${willQueue ? '<p class="bg-upload__note"><i class="fa-solid fa-circle-info"></i> היצירה תופיע בגלריה אחרי אישור של צוות הפורום.</p>' : ''}
			</form>
		`);
		const tools = form.find('datalist');
		TOOLS.forEach(name => $('<option>').attr('value', name).appendTo(tools));
		const styles = form.find('.bg-upload__styles');
		STYLES.forEach(name => $('<button type="button" class="btn btn-sm bg-upload__style" aria-pressed="false"></button>').text(name).appendTo(styles));

		const dialog = bootbox.dialog({
			title: '<i class="fa-solid fa-images"></i> שיתוף יצירה',
			message: form,
			className: 'bg-upload-dialog',
			size: 'large',
			backdrop: true,
			onEscape: true,
			buttons: {
				cancel: { label: 'ביטול', className: 'btn-outline-secondary' },
				submit: {
					label: '<i class="fa-solid fa-paper-plane"></i> פרסום',
					className: 'btn-primary bg-upload__submit',
					callback: () => {
						submit();
						return false; // the dialog closes itself after a successful upload
					},
				},
			},
		});
		dialog.on('hidden.bs.modal', () => {
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl);
			}
		});

		const drop = form.find('.bg-upload__drop');
		const input = form.find('.bg-upload__file');

		function setFile(f) {
			if (!f) {
				return;
			}
			if (!IMAGE_TYPES.includes(f.type)) {
				return alerts.error('אפשר להעלות רק תמונה: PNG, JPG, WEBP או GIF.');
			}
			if (maxKb && f.size > maxKb * 1024) {
				return alerts.error(`הקובץ גדול מדי (${formatSize(f.size)}). אפשר עד ${formatSize(maxKb * 1024)}.`);
			}
			file = f;
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl);
			}
			previewUrl = URL.createObjectURL(f);
			form.find('.bg-upload__preview').attr('src', previewUrl).prop('hidden', false);
			form.find('.bg-upload__empty').prop('hidden', true);
			drop.addClass('has-file');
		}

		input.on('change', () => setFile(input[0].files[0]));
		drop.on('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				input.trigger('click');
			}
		});
		drop.on('dragenter dragover', (e) => {
			e.preventDefault();
			drop.addClass('is-over');
		});
		drop.on('dragleave dragend', () => drop.removeClass('is-over'));
		drop.on('drop', (e) => {
			e.preventDefault();
			drop.removeClass('is-over');
			const dt = e.originalEvent.dataTransfer;
			setFile(dt && dt.files && dt.files[0]);
		});
		dialog.on('paste', (e) => {
			const items = (e.originalEvent.clipboardData && e.originalEvent.clipboardData.items) || [];
			const item = Array.from(items).find(i => i.kind === 'file' && IMAGE_TYPES.includes(i.type));
			if (item) {
				e.preventDefault();
				setFile(item.getAsFile());
			}
		});

		styles.on('click', '.bg-upload__style', function () {
			const btn = $(this);
			const on = btn.attr('aria-pressed') !== 'true';
			if (on && styles.find('[aria-pressed="true"]').length >= MAX_STYLES) {
				return alerts.alert({ type: 'info', message: `אפשר לבחור עד ${MAX_STYLES} סגנונות.`, timeout: 2500 });
			}
			btn.attr('aria-pressed', String(on)).toggleClass('active', on);
		});

		let busy = false;
		async function submit() {
			if (busy) {
				return;
			}
			if (!file) {
				drop.addClass('is-missing');
				setTimeout(() => drop.removeClass('is-missing'), 1500);
				return alerts.error('בחרו תמונה כדי לשתף.');
			}
			const usage = form.find('[name="usage"]:checked').val();
			if (!usage) {
				const box = form.find('.bg-upload__usage').addClass('is-missing');
				box[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
				setTimeout(() => box.removeClass('is-missing'), 1500);
				return alerts.error('בחרו אם אתם מאשרים לאחרים להשתמש בתמונה.');
			}
			busy = true;
			const button = dialog.find('.bg-upload__submit');
			const label = button.html();
			button.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> מעלה...');
			try {
				const url = await uploadImage(file);
				const title = String(form.find('[name="title"]').val() || '').trim() ||
					`יצירה של ${app.user.displayname || app.user.username}`;
				const content = buildContent({
					url,
					alt: String(form.find('[name="title"]').val() || '').trim() || file.name,
					tool: String(form.find('[name="tool"]').val() || '').trim(),
					styles: styles.find('[aria-pressed="true"]').toArray().map(b => $(b).text()),
					prompt: String(form.find('[name="prompt"]').val() || '').trim(),
					usage: (USAGE.find(u => u.key === usage) || USAGE[0]).text,
				});
				const result = await api.post('/topics', { cid, title, content, tags: [] });
				dialog.modal('hide');
				if (result && result.queued) {
					alerts.success('היצירה נשלחה, ותופיע בגלריה אחרי אישור. תודה!', 6000);
				} else {
					alerts.success('היצירה פורסמה בגלריה. תודה!');
					ajaxify.refresh();
				}
			} catch (err) {
				alerts.error(err);
				button.prop('disabled', false).html(label);
			} finally {
				busy = false;
			}
		}
	}

	async function uploadImage(f) {
		const body = new FormData();
		body.append('files[]', f, f.name);
		const res = await fetch(`${config.relative_path}/api/post/upload`, {
			method: 'POST',
			body,
			credentials: 'same-origin',
			headers: { 'x-csrf-token': config.csrf_token },
		});
		let json = null;
		try {
			json = await res.json();
		} catch (e) { /* not JSON, e.g. a proxy error page */ }
		const image = json && json.response && json.response.images && json.response.images[0];
		if (!res.ok || !image || !image.url) {
			if (res.status === 413) {
				throw new Error('הקובץ גדול מדי.');
			}
			throw new Error((json && json.status && json.status.message) || '[[error:upload-error-fallback]]');
		}
		return image.url;
	}

	function buildContent({ url, alt, tool, styles, prompt, usage }) {
		const lines = [`![${alt.replace(/[[\]\n]/g, ' ')}](${url})`, ''];
		if (usage) {
			lines.push(`**אישור שימוש:** ${usage}`, '');
		}
		if (tool) {
			lines.push(`**הכלי / המודל:** ${tool.replace(/\s*\n\s*/g, ' ')}`, '');
		}
		if (styles.length) {
			lines.push(`**סגנונות:** ${styles.join(', ')}`, '');
		}
		if (prompt) {
			// a code block keeps the prompt exactly as typed; the fence is longer than any ``` inside it
			const longest = Math.max(2, ...(prompt.match(/`+/g) || []).map(m => m.length));
			const fence = '`'.repeat(longest + 1);
			lines.push('**הפרומפט:**', fence, prompt, fence, '');
		}
		return lines.join('\n');
	}

	function formatSize(bytes) {
		return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')}MB` : `${Math.round(bytes / 1024)}KB`;
	}

	/* ------------------------------------------------------ load more */

	async function loadMore() {
		const btn = $(this);
		const next = parseInt(btn.attr('data-next'), 10);
		const sort = $('.bina-gallery').attr('data-sort');
		btn.prop('disabled', true);
		try {
			const res = await fetch(`${config.relative_path}/api/gallery?sort=${encodeURIComponent(sort)}&page=${next}`, {
				credentials: 'same-origin',
			});
			const data = await res.json();
			const cards = data.items.map(item => buildCard(item)[0]);
			if (masonry.grid) {
				masonry.add(cards);
			} else {
				$('.bina-gallery .bg-grid').append(cards);
			}
			if (data.hasMore) {
				btn.attr('data-next', data.nextPage).prop('disabled', false);
			} else {
				btn.closest('.bg-more').remove();
			}
		} catch (err) {
			btn.prop('disabled', false);
			alerts.error('[[error:no-connection]]');
		}
	}

	function decode(html) {
		const t = document.createElement('textarea');
		t.innerHTML = html;
		return t.value;
	}

	function buildCard(item) {
		const a = $('<a class="bg-card bg-open"></a>');
		a.attr({
			href: `${config.relative_path}/topic/${item.slug}`,
			'data-index': item.index,
			'data-tid': item.tid,
			'data-pid': item.pid,
			'data-image': item.image,
			'data-title': decode(item.title),
			'data-votes': item.votes,
			'data-upvoted': item.upvoted,
			'data-replies': item.replies,
			'data-author': decode(item.user.displayname),
			'data-userslug': item.user.userslug,
			'data-tool': decode(item.tool || ''),
			'data-styles': decode(item.styles || ''),
			'data-has-prompt': String(!!item.hasPrompt),
			'data-usage': item.usage || '',
		});
		const img = $('<img loading="lazy" decoding="async">').attr({ src: item.thumb || item.image, alt: decode(item.title) });
		if (item.w > 0 && item.h > 0) {
			img.attr({ width: item.w, height: item.h });
		}
		img.appendTo(a);
		const overlay = $('<div class="bg-card__overlay"></div>').appendTo(a);
		$('<div class="bg-card__title"></div>').html(item.title).appendTo(overlay);
		const meta = $('<div class="bg-card__meta"></div>').appendTo(overlay);
		$('<span class="bg-card__author"></span>')
			.html(`${helpers.buildAvatar(item.user, '20px', true)} `)
			.append(document.createTextNode(decode(item.user.displayname)))
			.appendTo(meta);
		$('<span class="bg-card__stats"></span>').html(
			`<span class="bg-card__votes"><i class="fa-solid fa-heart"></i> <span class="bg-count">${parseInt(item.votes, 10) || 0}</span></span> ` +
			`<span><i class="fa-regular fa-comment"></i> ${parseInt(item.replies, 10) || 0}</span>`
		).appendTo(meta);
		return a;
	}

	/* ------------------------------------------------------- lightbox */

	function openLightbox(cards, index) {
		closeLightbox();
		lightbox = $(`
			<div class="bg-lightbox" role="dialog" aria-modal="true" tabindex="-1">
				<button type="button" class="bg-lb__close" aria-label="סגירה"><i class="fa-solid fa-xmark"></i></button>
				<button type="button" class="bg-lb__nav bg-lb__prev" aria-label="הקודמת"><i class="fa-solid fa-chevron-right"></i></button>
				<button type="button" class="bg-lb__nav bg-lb__next" aria-label="הבאה"><i class="fa-solid fa-chevron-left"></i></button>
				<figure class="bg-lb__figure">
					<img class="bg-lb__img" alt="">
					<figcaption class="bg-lb__caption">
						<div class="bg-lb__title"></div>
						<div class="bg-lb__row">
							<div class="bg-lb__who">
								<a class="bg-lb__author"></a>
								<span class="bg-lb__tool" hidden><i class="fa-solid fa-wand-magic-sparkles"></i> <span></span></span>
								<span class="bg-lb__styles"></span>
							</div>
							<div class="bg-lb__actions">
								<button type="button" class="btn btn-sm btn-outline-light bg-lb__prompt-toggle" aria-expanded="false" hidden><i class="fa-solid fa-terminal"></i> פרומפט</button>
								<button type="button" class="btn btn-sm bg-lb__like"><i class="fa-heart"></i> <span class="bg-lb__count"></span></button>
								<a class="btn btn-sm btn-light bg-lb__topic"><i class="fa-regular fa-comment"></i> <span class="bg-lb__replies"></span> · לנושא המלא</a>
							</div>
						</div>
						<div class="bg-lb__usage" hidden><i class="fa-solid"></i> <span></span></div>
						<div class="bg-lb__prompt" hidden>
							<button type="button" class="btn btn-sm btn-outline-light bg-lb__copy"><i class="fa-regular fa-copy"></i> העתקה</button>
							<pre class="bg-lb__prompt-text" dir="auto"></pre>
						</div>
					</figcaption>
				</figure>
			</div>
		`).appendTo('body');
		$('body').addClass('bg-lightbox-open');

		lightbox.on('click', function (e) {
			if (e.target === this || $(e.target).is('.bg-lb__figure')) {
				closeLightbox();
			}
		});
		lightbox.on('click', '.bg-lb__close', closeLightbox);
		lightbox.on('click', '.bg-lb__prev', () => show(cards, current - 1));
		lightbox.on('click', '.bg-lb__next', () => show(cards, current + 1));
		lightbox.on('click', '.bg-lb__like', () => toggleLike(cards.eq(current)));
		lightbox.on('click', '.bg-lb__topic, .bg-lb__author', closeLightbox);
		lightbox.on('click', '.bg-lb__prompt-toggle', function () {
			const open = $(this).attr('aria-expanded') !== 'true';
			$(this).attr('aria-expanded', String(open)).toggleClass('active', open);
			lightbox.find('.bg-lb__prompt').prop('hidden', !open);
			lightbox.toggleClass('bg-lb--prompt', open);
		});
		lightbox.on('click', '.bg-lb__copy', () => copyText(lightbox.find('.bg-lb__prompt-text').text()));
		$(document).on('keydown.binaGallery', (e) => {
			if (e.key === 'Escape') {
				closeLightbox();
			} else if (e.key === 'ArrowLeft') {
				show(cards, current + 1); // RTL: left is "next"
			} else if (e.key === 'ArrowRight') {
				show(cards, current - 1);
			}
		});

		show(cards, index);
		lightbox.trigger('focus');
	}

	function show(cards, index) {
		if (!lightbox || index < 0 || index >= cards.length) {
			return;
		}
		current = index;
		const card = cards.eq(index);
		const d = card[0].dataset;
		lightbox.find('.bg-lb__img').attr({ src: d.image, alt: d.title });
		lightbox.find('.bg-lb__title').text(d.title);
		lightbox.find('.bg-lb__author').text(d.author).attr('href', `${config.relative_path}/user/${d.userslug}`);
		lightbox.find('.bg-lb__topic').attr('href', card.attr('href'));
		lightbox.find('.bg-lb__replies').text(d.replies);
		lightbox.find('.bg-lb__prev').toggleClass('invisible', index === 0);
		lightbox.find('.bg-lb__next').toggleClass('invisible', index === cards.length - 1);
		renderLike(card);
		renderDetails(card);
	}

	// Tool and styles come with the card; the prompt (which can be long) is loaded when needed.
	function renderDetails(card) {
		const d = card[0].dataset;
		const usage = USAGE_SHOWN[d.usage];
		const usageEl = lightbox.find('.bg-lb__usage').prop('hidden', !usage).attr('data-usage', d.usage || '');
		if (usage) {
			usageEl.find('i').attr('class', `fa-solid ${usage.icon}`);
			usageEl.find('span').text(usage.text);
		}
		lightbox.find('.bg-lb__tool').prop('hidden', !d.tool).find('span').text(d.tool || '');
		const styles = lightbox.find('.bg-lb__styles').empty();
		(d.styles ? d.styles.split(',') : []).map(st => st.trim()).filter(Boolean)
			.forEach(st => $('<span class="bg-lb__style"></span>').text(st).appendTo(styles));

		const toggle = lightbox.find('.bg-lb__prompt-toggle');
		const panel = lightbox.find('.bg-lb__prompt');
		const text = lightbox.find('.bg-lb__prompt-text').text('');
		const hasPrompt = d.hasPrompt === 'true';
		toggle.prop('hidden', !hasPrompt);
		if (!hasPrompt) {
			panel.prop('hidden', true);
			lightbox.removeClass('bg-lb--prompt');
			toggle.attr('aria-expanded', 'false').removeClass('active');
			return;
		}
		const tid = d.tid;
		loadDetails(tid).then((data) => {
			if (lightbox && current >= 0 && card[0].dataset.tid === tid && data) {
				text.text(data.prompt || '');
			}
		});
	}

	async function loadDetails(tid) {
		if (!details.has(tid)) {
			details.set(tid, api.get(`/plugins/bina-gallery/items/${tid}`, {}).catch(() => {
				details.delete(tid);
				return null;
			}));
		}
		return details.get(tid);
	}

	async function copyText(value) {
		try {
			await navigator.clipboard.writeText(value);
			alerts.success('הפרומפט הועתק.', 2000);
		} catch (err) {
			// older browsers / no permission: select the text so it can be copied by hand
			const range = document.createRange();
			range.selectNodeContents(lightbox.find('.bg-lb__prompt-text')[0]);
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
		}
	}

	function renderLike(card) {
		const d = card[0].dataset;
		const liked = d.upvoted === 'true';
		lightbox.find('.bg-lb__like')
			.toggleClass('btn-danger', liked).toggleClass('btn-outline-light', !liked)
			.attr('aria-pressed', liked)
			.find('i').toggleClass('fa-solid', liked).toggleClass('fa-regular', !liked);
		lightbox.find('.bg-lb__count').text(d.votes);
	}

	async function toggleLike(card) {
		if (!app.user.uid) {
			closeLightbox();
			return ajaxify.go('login');
		}
		const d = card[0].dataset;
		const liked = d.upvoted === 'true';
		try {
			if (liked) {
				await api.del(`/posts/${d.pid}/vote`, {});
			} else {
				await api.put(`/posts/${d.pid}/vote`, { delta: 1 });
			}
			const votes = (parseInt(d.votes, 10) || 0) + (liked ? -1 : 1);
			card.attr({ 'data-upvoted': String(!liked), 'data-votes': votes });
			card.find('.bg-count').text(votes);
			if (lightbox) {
				renderLike(card);
			}
		} catch (err) {
			alerts.error(err);
		}
	}

	function closeLightbox() {
		if (lightbox) {
			lightbox.remove();
			lightbox = null;
		}
		current = -1;
		$('body').removeClass('bg-lightbox-open');
		$(document).off('keydown.binaGallery');
	}

	return Gallery;
});
