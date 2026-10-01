<div class="bina-gallery bina-creation" data-tid="{tid}" data-pid="{pid}" data-mainpid="{pid}">
	<div class="bgc-top">
		<a class="bgc-back" href="{config.relative_path}/gallery"><i class="fa-solid fa-arrow-right"></i> לגלריית היצירות</a>
		{{{ if position }}}<span class="bgc-pos">{position} מתוך {total}</span>{{{ end }}}
	</div>

	<div class="bgc-layout">
		<div class="bgc-stage">
			<a class="bgc-image" href="{image}" target="_blank" rel="noopener" title="פתיחה בגודל מלא">
				<img src="{item.thumb}" alt="{item.title}" {{{ if item.w }}}width="{item.w}" height="{item.h}" {{{ end }}}fetchpriority="high">
			</a>
			{{{ if newer }}}
			<a class="bgc-nav bgc-nav--newer" href="{config.relative_path}/gallery/{newer.tid}" title="היצירה הבאה: {newer.title}" aria-label="היצירה הבאה"><i class="fa-solid fa-chevron-right"></i></a>
			{{{ end }}}
			{{{ if older }}}
			<a class="bgc-nav bgc-nav--older" href="{config.relative_path}/gallery/{older.tid}" title="היצירה הקודמת: {older.title}" aria-label="היצירה הקודמת"><i class="fa-solid fa-chevron-left"></i></a>
			{{{ end }}}
		</div>

		<aside class="bgc-panel">
			{{{ if deleted }}}
			<div class="alert alert-warning py-2"><i class="fa-solid fa-trash"></i> היצירה נמחקה. רק צוות הפורום רואה אותה.</div>
			{{{ end }}}

			<h1 class="bgc-title">{item.title}</h1>

			<div class="bgc-author">
				<a class="bgc-author__avatar" href="{config.relative_path}/user/{author.userslug}">{{buildAvatar(author, "44px", true)}}</a>
				<div class="bgc-author__text">
					<a class="bgc-author__name" href="{config.relative_path}/user/{author.userslug}">{author.displayname}</a>
					<span class="bgc-author__meta">
						<span title="ניקוד יוצר בגלריה"><i class="fa-solid fa-heart"></i> {authorScore}</span>
						<span><i class="fa-regular fa-image"></i> {authorCreations} יצירות</span>
						<span class="timeago" title="{timestampISO}"></span>
					</span>
				</div>
				{{{ if canFollow }}}
				<button type="button" class="btn btn-sm bgc-follow {{{ if isFollowing }}}is-following{{{ end }}}" data-uid="{author.uid}" aria-pressed="{isFollowing}">
					<span class="bgc-follow__on"><i class="fa-solid fa-check"></i> במעקב</span>
					<span class="bgc-follow__off"><i class="fa-solid fa-plus"></i> מעקב</span>
				</button>
				{{{ end }}}
			</div>

			<div class="bgc-actions">
				<button type="button" class="btn bgc-like {{{ if item.upvoted }}}is-liked{{{ end }}}" data-pid="{pid}" data-votes="{item.votes}" data-upvoted="{item.upvoted}" aria-pressed="{item.upvoted}">
					<i class="fa-heart {{{ if item.upvoted }}}fa-solid{{{ else }}}fa-regular{{{ end }}}"></i> <span class="bgc-like__count">{item.votes}</span>
				</button>
				<button type="button" class="btn bgc-btn bgc-copy-link"><i class="fa-solid fa-link"></i> העתקת קישור</button>
				<a class="btn bgc-btn" href="{image}" target="_blank" rel="noopener"><i class="fa-solid fa-expand"></i> גודל מלא</a>
				{{{ if canEdit }}}
				<button type="button" class="btn bgc-btn bgc-edit"><i class="fa-solid fa-pen"></i> עריכה</button>
				{{{ end }}}
				<a class="btn bgc-btn bgc-icon" href="{config.relative_path}/topic/{slug}?raw=1" title="הנושא בפורום" aria-label="הנושא בפורום"><i class="fa-regular fa-comments"></i></a>
			</div>

			{{{ if usage }}}
			<div class="bgc-usage" data-usage="{usage}"><i class="fa-solid {usageIcon}"></i> {usageText}</div>
			{{{ end }}}

			{{{ if tool }}}
			<div class="bgc-detail">
				<div class="bgc-detail__label">הכלי / המודל</div>
				<div class="bgc-detail__value"><i class="fa-solid fa-wand-magic-sparkles"></i> {tool}</div>
			</div>
			{{{ end }}}
			{{{ if hasStyles }}}
			<div class="bgc-detail">
				<div class="bgc-detail__label">סגנון</div>
				<div class="bgc-chips">{{{ each styles }}}<span class="bgc-chip">{./name}</span>{{{ end }}}</div>
			</div>
			{{{ end }}}

			{{{ if hasPrompt }}}
			<section class="bgc-prompt">
				<div class="bgc-prompt__head">
					<h2 class="bgc-h2">פרומפט</h2>
					<button type="button" class="btn btn-sm bgc-btn bgc-copy"><i class="fa-regular fa-copy"></i> העתקה</button>
				</div>
				<pre class="bgc-prompt__text" dir="auto"></pre>
				<button type="button" class="bgc-prompt__more" hidden>הצגת כל הפרומפט <i class="fa-solid fa-chevron-down"></i></button>
			</section>
			{{{ end }}}

			<section class="bgc-comments" id="comments">
				<h2 class="bgc-h2">תגובות <span class="bgc-comments__count">{commentCount}</span></h2>
				<ul class="bgc-comments__list"></ul>
				{{{ if canReply }}}
				<form class="bgc-reply">
					<textarea class="form-control" rows="2" maxlength="5000" placeholder="כתבו תגובה על היצירה..." aria-label="תגובה"></textarea>
					<button type="submit" class="btn btn-primary btn-sm bgc-reply__send"><i class="fa-solid fa-paper-plane"></i> שליחה</button>
				</form>
				{{{ else }}}
				{{{ if !loggedIn }}}
				<p class="bgc-muted"><a href="{config.relative_path}/login">התחברו</a> כדי להגיב.</p>
				{{{ end }}}
				{{{ end }}}
			</section>
		</aside>
	</div>

	{{{ if hasMore }}}
	<section class="bgc-more">
		<div class="bgc-more__head">
			<h2 class="bgc-h2">עוד יצירות של {author.displayname}</h2>
			<a href="{config.relative_path}/user/{author.userslug}/gallery">לכל היצירות <i class="fa-solid fa-arrow-left"></i></a>
		</div>
		<div class="bgc-more__grid">
			{{{ each more }}}
			<a class="bgc-more__item" href="{config.relative_path}/gallery/{./tid}" title="{./title}">
				<img src="{./thumb}" alt="{./title}" loading="lazy" decoding="async">
				<span class="bgc-more__title">{./title}</span>
			</a>
			{{{ end }}}
		</div>
	</section>
	{{{ end }}}
</div>
