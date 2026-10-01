<!-- IMPORT partials/account/header.tpl -->

<div class="bina-gallery bina-profile-gallery" data-api="/api/user/{userslug}/gallery">
	<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
		<h3 class="fw-semibold fs-5 mb-0">יצירות בגלריה</h3>
		<div class="bpg-stats">
			<span><i class="fa-regular fa-image"></i> {creationCount} יצירות</span>
			<span><i class="fa-solid fa-heart"></i> {hearts} לבבות</span>
			{{{ if canPost }}}
			<a class="btn btn-sm btn-primary" href="{config.relative_path}/gallery"><i class="fa-solid fa-plus"></i> שתפו יצירה</a>
			{{{ end }}}
		</div>
	</div>

	{{{ if empty }}}
	<div class="bg-empty">
		<i class="fa-regular fa-image"></i>
		<p>עוד אין כאן יצירות בגלריה.</p>
	</div>
	{{{ end }}}

	<div class="bg-grid">
		{{{ each items }}}
		<!-- IMPORT partials/bina-gallery/card.tpl -->
		{{{ end }}}
	</div>

	{{{ if hasMore }}}
	<div class="bg-more">
		<button type="button" class="btn btn-outline-primary bg-load-more" data-next="{nextPage}">טעינת יצירות נוספות</button>
	</div>
	{{{ end }}}
</div>

<!-- IMPORT partials/account/footer.tpl -->
