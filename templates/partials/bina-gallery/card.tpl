<a class="bg-card bg-open" href="{config.relative_path}/gallery/{./tid}" data-index="{./index}" data-tid="{./tid}" data-pid="{./pid}" data-image="{./image}" data-title="{./title}" data-votes="{./votes}" data-upvoted="{./upvoted}" data-replies="{./replies}" data-author="{./user.displayname}" data-userslug="{./user.userslug}" data-tool="{./tool}" data-styles="{./styles}" data-has-prompt="{./hasPrompt}" data-usage="{./usage}">
	<img src="{./thumb}" alt="{./title}" {{{ if ./w }}}width="{./w}" height="{./h}" {{{ end }}}loading="lazy" decoding="async">
	<span class="bg-card__like {{{ if ./upvoted }}}is-liked{{{ end }}}" role="button" tabindex="0" aria-label="אהבתי" aria-pressed="{./upvoted}"><i class="{{{ if ./upvoted }}}fa-solid{{{ else }}}fa-regular{{{ end }}} fa-heart"></i></span>
	<div class="bg-card__overlay">
		<div class="bg-card__title">{./title}</div>
		<div class="bg-card__meta">
			<span class="bg-card__author">{{buildAvatar(./user, "20px", true)}} {./user.displayname}</span>
			<span class="bg-card__stats"><span class="bg-card__votes"><i class="fa-solid fa-heart"></i> <span class="bg-count">{./votes}</span></span> <span><i class="fa-regular fa-comment"></i> {./replies}</span></span>
		</div>
	</div>
</a>
