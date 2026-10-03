'use strict';

// The gallery's share / edit window (require(['bina-gallery-upload'])).
// One form for a new creation (gallery page, "שתפו יצירה") and for editing one (creation page,
// "עריכה"): a picture, an optional title, the tool, up to three styles, the prompt and the usage
// permission. The picture goes through the forum's regular upload and the post through the regular
// API, so permissions, the post queue, rate limits and EXIF removal all apply as usual.
// The details are written into the post with fixed labels; the server reads them from there.
define('bina-gallery-upload', ['api', 'alerts', 'bootbox'], function (api, alerts, bootbox) {
	const Upload = {};

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
	const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

	Upload.USAGE = USAGE;

	/* ----------------------------------------------------------- post content */

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

	// Reads a post written by buildContent(). Returns null for anything else (older creations made
	// with the composer, or a post with extra text), so editing never drops a word: such posts are
	// edited in the regular composer. A match is confirmed by rebuilding the post and comparing.
	function parseContent(raw) {
		// NodeBB trims the end of a post when saving it, so the last field has no blank line after it
		const text = String(raw || '').replace(/\r\n/g, '\n');
		let rest = `${text.trimEnd()}\n\n`;
		const take = (re) => {
			const m = re.exec(rest);
			if (m) {
				rest = rest.slice(m[0].length);
			}
			return m;
		};
		const image = take(/^!\[([^\]\n]*)\]\(([^)\s]+)\)\n\n/);
		if (!image) {
			return null;
		}
		const usage = take(/^\*\*אישור שימוש:\*\* ([^\n]+)\n\n/);
		const tool = take(/^\*\*הכלי \/ המודל:\*\* ([^\n]+)\n\n/);
		const styles = take(/^\*\*סגנונות:\*\* ([^\n]+)\n\n/);
		const prompt = take(/^\*\*הפרומפט:\*\*\n(`{3,})\n([\s\S]*?)\n\1\n?/);
		if (rest.trim()) {
			return null;
		}
		const usageItem = usage ? USAGE.find(u => u.text === usage[1]) : null;
		if (usage && !usageItem) {
			return null;
		}
		const fields = {
			alt: image[1],
			url: image[2],
			usage: usageItem ? usageItem.key : '',
			tool: tool ? tool[1] : '',
			styles: styles ? styles[1].split(', ').filter(Boolean) : [],
			prompt: prompt ? prompt[2] : '',
		};
		const rebuilt = buildContent({ ...fields, usage: usageItem ? usageItem.text : '' });
		return rebuilt.trimEnd() === text.trimEnd() ? fields : null;
	}

	/* ------------------------------------------------------------------ window */

	// options: { cid, willQueue, lastUsage } to share a new creation, or
	//          { edit: { pid, title, image, fields } } to edit one (fields from parseContent)
	Upload.open = function (options) {
		const edit = options.edit || null;
		const initial = edit ? edit.fields : { tool: '', styles: [], prompt: '', usage: options.lastUsage || '' };
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
					<span class="bg-upload__replace" hidden><i class="fa-solid fa-arrows-rotate"></i> להחלפת התמונה: לחצו, גררו או הדביקו</span>
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
								<input type="radio" name="usage" value="${u.key}">
								<span><i class="fa-solid ${u.icon}"></i> <b>${u.label}</b><small>${u.hint}</small></span>
							</label>`).join('')}
					</div>
				</fieldset>
				${!edit && options.willQueue ? '<p class="bg-upload__note"><i class="fa-solid fa-circle-info"></i> היצירה תופיע בגלריה אחרי אישור של צוות הפורום.</p>' : ''}
			</form>
		`);
		const tools = form.find('datalist');
		TOOLS.forEach(name => $('<option>').attr('value', name).appendTo(tools));
		const styles = form.find('.bg-upload__styles');
		// the creation's own styles first (also ones that are no longer in the list), then the list
		const styleNames = [...initial.styles, ...STYLES.filter(st => !initial.styles.includes(st))];
		styleNames.forEach((name) => {
			const on = initial.styles.includes(name);
			$('<button type="button" class="btn btn-sm bg-upload__style"></button>')
				.text(name).attr('aria-pressed', String(on)).toggleClass('active', on).appendTo(styles);
		});
		form.find('[name="title"]').val(edit ? edit.title : '');
		form.find('[name="tool"]').val(initial.tool);
		form.find('[name="prompt"]').val(initial.prompt);
		if (initial.usage) {
			form.find(`[name="usage"][value="${initial.usage}"]`).prop('checked', true);
		}

		const drop = form.find('.bg-upload__drop');
		const input = form.find('.bg-upload__file');
		if (edit) {
			form.find('.bg-upload__preview').attr('src', edit.image).prop('hidden', false);
			form.find('.bg-upload__empty').prop('hidden', true);
			form.find('.bg-upload__replace').prop('hidden', false);
			drop.addClass('has-file');
		}

		const dialog = bootbox.dialog({
			title: edit ? '<i class="fa-solid fa-pen"></i> עריכת יצירה' : '<i class="fa-solid fa-images"></i> שיתוף יצירה',
			message: form,
			className: 'bg-upload-dialog',
			size: 'large',
			backdrop: true,
			onEscape: true,
			buttons: {
				cancel: { label: 'ביטול', className: 'btn-outline-secondary' },
				submit: {
					label: edit ? '<i class="fa-solid fa-check"></i> שמירה' : '<i class="fa-solid fa-paper-plane"></i> פרסום',
					className: 'btn-primary bg-upload__submit',
					callback: () => {
						submit();
						return false; // the dialog closes itself after a successful save
					},
				},
			},
		});
		dialog.on('hidden.bs.modal', () => {
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl);
			}
		});

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
			if (!file && !edit) {
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
			button.prop('disabled', true).html(`<i class="fa-solid fa-spinner fa-spin"></i> ${file ? 'מעלה...' : 'שומר...'}`);
			try {
				const typedTitle = String(form.find('[name="title"]').val() || '').trim();
				const url = file ? await uploadImage(file) : edit.fields.url;
				const content = buildContent({
					url,
					alt: typedTitle || (file ? file.name : edit.fields.alt),
					tool: String(form.find('[name="tool"]').val() || '').trim(),
					styles: styles.find('[aria-pressed="true"]').toArray().map(b => $(b).text()),
					prompt: String(form.find('[name="prompt"]').val() || '').trim(),
					usage: (USAGE.find(u => u.key === usage) || USAGE[0]).text,
				});

				if (edit) {
					// the title is only sent when it was changed, so an untouched title stays exactly as it was
					const payload = { content };
					if (typedTitle && typedTitle !== edit.title) {
						payload.title = typedTitle;
					}
					await api.put(`/posts/${edit.pid}`, payload);
					dialog.modal('hide');
					alerts.success('היצירה עודכנה.');
					ajaxify.refresh();
					return;
				}

				const title = typedTitle || `יצירה של ${app.user.displayname || app.user.username}`;
				const result = await api.post('/topics', { cid: options.cid, title, content, tags: [] });
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
	};

	// Edit a creation: the gallery window when the post is in the gallery's own format, otherwise
	// the regular composer (nothing that was written in the post may be lost).
	Upload.edit = async function ({ pid, title, image }) {
		let raw = '';
		try {
			({ content: raw } = await api.get(`/posts/${pid}/raw`));
		} catch (err) {
			return alerts.error(err);
		}
		const fields = parseContent(raw);
		if (!fields) {
			const [hooks] = await app.require(['hooks']);
			alerts.alert({
				type: 'info',
				title: 'עריכה בעורך הרגיל',
				message: 'ביצירה הזו יש טקסט שחלון העריכה של הגלריה לא מכיר, ולכן היא נפתחת בעורך הרגיל, כדי ששום דבר לא יימחק.',
				timeout: 6000,
			});
			return hooks.fire('action:composer.post.edit', { pid });
		}
		Upload.open({ edit: { pid, title, image, fields } });
	};

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

	function formatSize(bytes) {
		return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')}MB` : `${Math.round(bytes / 1024)}KB`;
	}

	// for tests
	Upload.buildContent = buildContent;
	Upload.parseContent = parseContent;

	return Upload;
});
