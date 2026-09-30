<div class="bina-gallery" data-sort="{sort}" data-cid="{cid}">
	<div class="bg-hero">
		<div class="bg-hero__text">
			<h1 class="bg-hero__title"><i class="fa-solid fa-images"></i> גלריית יצירות</h1>
			<p class="bg-hero__sub">יצירות AI של חברי הקהילה. הכל מאוחסן כאן בפורום, בלי קישורים לאתרים חיצוניים.</p>
		</div>
		<div class="bg-hero__actions">
			{{{ if canPost }}}
			<button type="button" class="btn btn-primary bg-share" data-cid="{cid}"><i class="fa-solid fa-plus"></i> שתפו יצירה</button>
			{{{ else }}}
			{{{ if !loggedIn }}}
			<a class="btn btn-primary" href="{config.relative_path}/login"><i class="fa-solid fa-right-to-bracket"></i> התחברו כדי לשתף</a>
			{{{ end }}}
			{{{ end }}}
			<a class="btn btn-outline-secondary" href="{config.relative_path}/category/{category.slug}"><i class="fa-solid fa-list"></i> תצוגת נושאים</a>
		</div>
	</div>

	{{{ if hasFeatured }}}
	<a class="bg-featured bg-open" href="{config.relative_path}/topic/{featured.slug}" data-tid="{featured.tid}" data-pid="{featured.pid}" data-image="{featured.image}" data-title="{featured.title}" data-votes="{featured.votes}" data-upvoted="{featured.upvoted}" data-replies="{featured.replies}" data-author="{featured.user.displayname}" data-userslug="{featured.user.userslug}">
		<img src="{featured.image}" alt="{featured.title}" loading="lazy">
		<div class="bg-featured__info">
			<span class="bg-featured__badge"><i class="fa-solid fa-crown"></i> יצירת היום</span>
			<div class="bg-featured__title">{featured.title}</div>
			<div class="bg-featured__meta">
				<span>{buildAvatar(featured.user, "20px", true)} {featured.user.displayname}</span>
				<span><i class="fa-solid fa-heart"></i> {featured.votes}</span>
			</div>
		</div>
	</a>
	{{{ end }}}

	<ul class="bg-sorts nav nav-pills" role="tablist">
		{{{ each sorts }}}
		<li class="nav-item"><a class="nav-link {{{ if ./active }}}active{{{ end }}}" href="{config.relative_path}{./url}">{{{ if ./icon }}}<i class="fa-solid {./icon}"></i> {{{ end }}}{./label}</a></li>
		{{{ end }}}
	</ul>

	{{{ if creatorsView }}}
	<div class="bg-leaders">
		<p class="bg-leaders__intro">הניקוד של יוצר הוא סך הלייקים שקיבל על היצירות שלו בגלריה. זה ניקוד נפרד מהמוניטין הרגיל של הפורום.</p>
		{{{ if noLeaders }}}
		<div class="bg-empty"><i class="fa-solid fa-trophy"></i><p>עוד אין יוצרים עם לייקים. שתפו יצירה ותהיו הראשונים בטבלה!</p></div>
		{{{ end }}}
		<ol class="bg-leaders__list">
			{{{ each leaders }}}
			<li class="bg-leader {{{ if ./top3 }}}bg-leader--top{{{ end }}}">
				<span class="bg-leader__rank">{{{ if ./medal }}}{./medal}{{{ else }}}{./rank}{{{ end }}}</span>
				<a class="bg-leader__user" href="{config.relative_path}/user/{./user.userslug}">{buildAvatar(./user, "36px", true)} <span>{./user.displayname}</span></a>
				<span class="bg-leader__creations" title="יצירות"><i class="fa-regular fa-image"></i> {./creations}</span>
				<span class="bg-leader__score" title="ניקוד יוצר"><i class="fa-solid fa-heart"></i> {./score}</span>
			</li>
			{{{ end }}}
		</ol>
	</div>
	{{{ end }}}


	{{{ if empty }}}
	<div class="bg-empty">
		<i class="fa-regular fa-image"></i>
		<p>עוד אין כאן יצירות. תהיו הראשונים לשתף!</p>
	</div>
	{{{ end }}}

	<div class="bg-grid">
		{{{ each items }}}
		<a class="bg-card bg-open" href="{config.relative_path}/topic/{./slug}" data-tid="{./tid}" data-pid="{./pid}" data-image="{./image}" data-title="{./title}" data-votes="{./votes}" data-upvoted="{./upvoted}" data-replies="{./replies}" data-author="{./user.displayname}" data-userslug="{./user.userslug}">
			<img src="{./image}" alt="{./title}" loading="lazy">
			<div class="bg-card__overlay">
				<div class="bg-card__title">{./title}</div>
				<div class="bg-card__meta">
					<span class="bg-card__author">{buildAvatar(./user, "20px", true)} {./user.displayname}</span>
					<span class="bg-card__stats"><span class="bg-card__votes"><i class="fa-solid fa-heart"></i> <span class="bg-count">{./votes}</span></span> <span><i class="fa-regular fa-comment"></i> {./replies}</span></span>
				</div>
			</div>
		</a>
		{{{ end }}}
	</div>

	{{{ if hasMore }}}
	<div class="bg-more">
		<button type="button" class="btn btn-outline-primary bg-load-more" data-next="{nextPage}">טעינת יצירות נוספות</button>
	</div>
	{{{ end }}}
</div>
