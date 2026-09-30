<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 col-md-8 px-0 mb-4" tabindex="0" dir="rtl">
			<form role="form" class="bina-gallery-settings">
				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">הגלריה</h5>
					<div class="mb-3">
						<label class="form-label" for="cid">קטגוריית הגלריה</label>
						<select class="form-select" id="cid" name="cid" style="max-width: 24rem;">
							<option value="">– בחרו קטגוריה –</option>
							{{{ each categories }}}
							<option value="{./cid}">{./name}</option>
							{{{ end }}}
						</select>
						<p class="form-text">כל נושא בקטגוריה הזו הוא יצירה אחת, והתמונה הראשונה בו מוצגת בגלריה. נושאים נעוצים ונושאים בלי תמונה לא מוצגים. הדף: <a href="{config.relative_path}/gallery" target="_blank">/gallery</a></p>
					</div>
				</div>

				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">אישור יצירות</h5>
					<div class="form-check form-switch mb-3">
						<input type="checkbox" class="form-check-input" id="moderation" name="moderation" checked>
						<label for="moderation" class="form-check-label">יצירות חדשות ממתינות לאישור מנהל לפני שהן מתפרסמות</label>
						<p class="form-text">יצירות ממתינות מופיעות ב<a href="{config.relative_path}/post-queue" target="_blank">תור האישור</a>. תגובות על יצירות לא עוברות אישור. מנהלים, מפקחים וחברי הקבוצה שלמטה מפרסמים ישירות.</p>
					</div>
					<div class="mb-3">
						<label class="form-label" for="approvedGroup">קבוצת היוצרים המאושרים</label>
						<input type="text" class="form-control" id="approvedGroup" name="approvedGroup" placeholder="יוצרים מאושרים" style="max-width: 24rem;">
						<p class="form-text">
							{{{ if groupExists }}}
							<i class="fa fa-check-circle text-success"></i> הקבוצה קיימת. <a href="{config.relative_path}/groups/{groupSlug}" target="_blank">להוספת משתמשים לקבוצה</a>
							{{{ else }}}
							<i class="fa fa-exclamation-circle text-warning"></i> אין קבוצה בשם הזה. צרו אותה בניהול ← קבוצות.
							{{{ end }}}
						</p>
					</div>
				</div>
				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">ניקוד יוצרים</h5>
					<p class="form-text">לייקים על יצירות (הפוסט הראשון בנושא בקטגוריית הגלריה) לא נספרים במוניטין הרגיל של הפורום, אלא בניקוד יוצר נפרד שמוצג ב<a href="{config.relative_path}/gallery?sort=creators" target="_blank">טבלת היוצרים המובילים</a> ובפרופיל. לייקים על תגובות ממשיכים להיספר במוניטין כרגיל.</p>
					<button type="button" class="btn btn-sm btn-outline-primary" id="bina-gallery-rebuild">חישוב מחדש של ניקוד היוצרים</button>
					<p class="form-text">מחשב מחדש את הניקוד וספירת היצירות מכל היצירות שבקטגוריה. לא משנה את המוניטין.</p>
				</div>
			</form>
		</div>

		<!-- IMPORT admin/partials/settings/toc.tpl -->
	</div>
</div>
