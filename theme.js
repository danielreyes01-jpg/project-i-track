// Theme System - Manage dark/light mode per user

const ITRACK_BRAND_LOGO = 'assets/project-itrack-logo.png';
const ITRACK_SITE_ICON = 'assets/project-itrack-icon.png';
const ITRACK_PAGE_KEY = String(window.location.pathname || '/').split('/').pop().replace(/\.html$/i, '').replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'home';
document.documentElement.classList.add('itrack-page-' + ITRACK_PAGE_KEY);

function initializeITrackBrandAssets() {
	if (!document.head.querySelector('link[data-itrack-font]')) {
		const fontLink = document.createElement('link');
		fontLink.rel = 'stylesheet';
		fontLink.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap';
		fontLink.dataset.itrackFont = 'true';
		document.head.appendChild(fontLink);
	}
	const setIcon = (rel, sizes) => {
		let link = document.head.querySelector(`link[rel="${rel}"]`);
		if (!link) {
			link = document.createElement('link');
			link.rel = rel;
			document.head.appendChild(link);
		}
		link.type = 'image/png';
		link.href = ITRACK_SITE_ICON;
		if (sizes) link.sizes = sizes;
	};
	setIcon('icon', '96x96');
	setIcon('shortcut icon', '96x96');
	setIcon('apple-touch-icon', '96x96');
	document.querySelectorAll('img.brand-logo').forEach((image) => {
		image.src = ITRACK_BRAND_LOGO;
		image.alt = 'Project i-Track logo';
	});
}

function initializeITrackPageLoader() {
	initializeITrackBrandAssets();
	if (document.getElementById('itrack-page-loader')) return;

	const loader = document.createElement('div');
	loader.id = 'itrack-page-loader';
	loader.className = 'itrack-page-loader';
	loader.setAttribute('role', 'status');
	loader.setAttribute('aria-live', 'polite');
	loader.setAttribute('aria-label', 'Loading Project i-Track');

	const logoFrame = document.createElement('div');
	logoFrame.className = 'itrack-page-loader-logo-frame';
	const loadingRing = document.createElement('span');
	loadingRing.className = 'itrack-page-loader-ring';
	loadingRing.setAttribute('aria-hidden', 'true');
	logoFrame.appendChild(loadingRing);

	const loadingText = document.createElement('div');
	loadingText.className = 'itrack-page-loader-text';
	loadingText.textContent = 'Loading Project i-Track...';

	loader.appendChild(logoFrame);
	loader.appendChild(loadingText);
	document.body.appendChild(loader);

	function showLoader() {
		loader.hidden = false;
		requestAnimationFrame(() => loader.classList.remove('is-hidden'));
	}

	function hideLoader() {
		setTimeout(() => {
			loader.classList.add('is-hidden');
			setTimeout(() => { loader.hidden = true; }, 260);
		}, 280);
	}

	window.showITrackLoader = showLoader;
	window.hideITrackLoader = hideLoader;

	document.addEventListener('click', (event) => {
		const target = event.target.closest('a[href], button');
		if (!target || target.hasAttribute('download') || target.getAttribute('target') === '_blank') return;
		const targetLabel = String(target.dataset.navLabel || target.textContent || '').trim();
		if (/create account/i.test(targetLabel) || target.closest('.itrack-account-popover, .itrack-account-overlay')) return;

		const href = String(target.getAttribute('href') || '');
		const action = String(target.getAttribute('onclick') || '');
		if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
			try {
				const destination = new URL(href, window.location.href);
				if (destination.origin === window.location.origin) showLoader();
			} catch (_) {
				// Ignore malformed or non-navigation links.
			}
		} else if (/location(?:\.href)?\s*=|location\.assign|location\.replace/i.test(action)) {
			showLoader();
		}
	}, true);

	window.addEventListener('beforeunload', showLoader);
	if (document.readyState === 'complete') hideLoader();
	else window.addEventListener('load', hideLoader, { once: true });
}

function createDepEdFixedHeader() {
	const pathname = String(window.location.pathname || '/').toLowerCase();
	const currentPage = pathname.split('/').pop();
	const consolidatedAccountPages = new Set(['approval.html', 'admin.html', 'approved.html']);
	if (consolidatedAccountPages.has(currentPage)) {
		window.location.replace('/user.html');
		return;
	}
	const isHeaderlessPage = pathname === '/' || pathname.endsWith('/index.html') || pathname.endsWith('/create.html');
	if (isHeaderlessPage) {
		document.documentElement.classList.add('login-page-without-deped-header');
		return;
	}

	if (document.getElementById('deped-fixed-header')) {
		return;
	}

	createFallbackAdministratorNavigation(pathname);

	const header = document.createElement('header');
	header.id = 'deped-fixed-header';
	header.className = 'deped-fixed-header';
	header.setAttribute('role', 'banner');

	const compactBar = document.createElement('div');
	compactBar.className = 'deped-compact-bar';
	compactBar.setAttribute('aria-hidden', 'false');

	const compactBrand = document.createElement('a');
	compactBrand.className = 'deped-compact-brand';
	compactBrand.href = '/dashboard.html';
	compactBrand.setAttribute('aria-label', 'Project i-Track home');

	const compactLogo = document.createElement('img');
	compactLogo.src = ITRACK_BRAND_LOGO;
	compactLogo.alt = 'Project i-Track';
	compactLogo.className = 'deped-compact-logo';
	compactBrand.appendChild(compactLogo);
	const compactBrandName = document.createElement('span');
	compactBrandName.className = 'deped-compact-brand-name';
	compactBrandName.textContent = 'PROJECT I-TRACK';
	compactBrand.appendChild(compactBrandName);

	const menuDock = document.createElement('div');
	menuDock.id = 'deped-mobile-navigation';
	menuDock.className = 'deped-compact-menu-dock';
	menuDock.setAttribute('aria-label', 'Site navigation');

	const menuToggle = document.createElement('button');
	menuToggle.className = 'deped-mobile-menu-toggle';
	menuToggle.type = 'button';
	menuToggle.setAttribute('aria-label', 'Open navigation menu');
	menuToggle.setAttribute('aria-controls', menuDock.id);
	menuToggle.setAttribute('aria-expanded', 'false');
	for (let line = 0; line < 3; line += 1) {
		const menuLine = document.createElement('span');
		menuLine.setAttribute('aria-hidden', 'true');
		menuToggle.appendChild(menuLine);
	}

	compactBar.appendChild(compactBrand);
	compactBar.appendChild(menuToggle);
	compactBar.appendChild(menuDock);
	header.appendChild(compactBar);

	document.body.insertBefore(header, document.body.firstChild);
	document.documentElement.classList.add('has-deped-fixed-header', 'compact-header-only');
	const hasNavigation = dockNavigationInHeader(menuDock);
	if (hasNavigation) {
		initializeMobileNavigation(header, menuToggle, menuDock);
	} else {
		menuToggle.hidden = true;
	}
}

function createFallbackAdministratorNavigation(pathname) {
	if (document.querySelector('.nav-menu')) return;
	const page = String(pathname || '').split('/').pop();
	const administratorPages = new Set(['admin.html', 'approval-request.html', 'approval.html', 'approved.html', 'user.html']);
	if (!administratorPages.has(page)) return;

	const panel = document.createElement('div');
	panel.className = 'nav-panel';
	const menu = document.createElement('nav');
	menu.className = 'nav-menu';
	menu.setAttribute('aria-label', 'Administrator navigation');
	[
		['Learner Record', 'learner.html'], ['Dashboard', 'dashboard.html'], ['FLP Request Form', 'adm-request.html'],
		['ADM Approval', 'approval-request.html'], ['Student Dashboard', 'admin-students.html'], ['Student Profile', 'student-profile.html'], ['Learning Resources', 'learning-resources.html'],
		['Reports', 'reports.html'], ['User Management', 'user.html'], ['Sign Out', 'signout.html']
	].forEach(([label, target]) => {
		const item = document.createElement('button');
		item.type = 'button';
		item.className = label === 'Sign Out' ? 'nav-item nav-item-signout' : 'nav-item';
		item.textContent = label;
		item.setAttribute('onclick', `window.location.href='${target}'`);
		menu.appendChild(item);
	});
	panel.appendChild(menu);
	document.body.insertBefore(panel, document.body.firstChild);
}

function initializeAdministratorReportsNavigation() {
	window.setTimeout(async () => {
		try {
			const response = await fetch('/api/auth/me', { credentials: 'include' });
			if (!response.ok) return;
			const payload = await response.json();
		const reportRole = String(payload && payload.user && payload.user.role || '').toLowerCase();
		if (!['admin', 'supervisor', 'principal'].includes(reportRole)) return;
			document.querySelectorAll('.nav-menu').forEach((menu) => {
				if (menu.querySelector('[data-itrack-reports-nav], [onclick*="reports.html"]')) return;
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'nav-item' + (/\/reports\.html$/i.test(location.pathname) ? ' nav-current' : '');
				button.dataset.itrackReportsNav = 'true';
				button.textContent = '📊 Reports';
				button.addEventListener('click', () => { window.location.href = 'reports.html'; });
				const items = Array.from(menu.querySelectorAll('.nav-item'));
				const userManagement = items.find((item) => /user management/i.test(item.textContent || ''));
				const signOut = items.find((item) => /sign out/i.test(item.textContent || ''));
				const anchor = (userManagement && userManagement.closest('.nav-dropdown')) || userManagement || signOut;
				if (anchor) anchor.insertAdjacentElement('beforebegin', button); else menu.appendChild(button);
			});
		} catch (_) {}
	}, 120);
}

function createITrackFooter() {
	if (!document.documentElement.classList.contains('has-deped-fixed-header') || document.getElementById('itrack-site-footer')) return;
	const footer = document.createElement('footer');
	footer.id = 'itrack-site-footer';
	footer.className = 'itrack-site-footer';
	footer.innerHTML = `
		<div class="itrack-site-footer-inner">
			<div class="itrack-footer-brand">
				<img src="${ITRACK_BRAND_LOGO}" alt="Project i-Track logo" class="itrack-footer-logo">
				<div><strong>PROJECT I-TRACK</strong><span>SDO CEBU PROVINCE</span></div>
			</div>
			<p class="itrack-footer-rights">ALL RIGHTS RESERVED © 2026<br><span>Department of Education • Division of Cebu Province</span></p>
			<p class="itrack-footer-credit">Project i-Track Website developed by:<br><a href="https://www.facebook.com/dan.rey0888" target="_blank" rel="noopener noreferrer">DANIEL P. REYES</a></p>
		</div>`;
	document.body.appendChild(footer);
}

function createITrackPageTitlebar() {
	if (!document.documentElement.classList.contains('has-deped-fixed-header') || document.getElementById('itrack-page-titlebar')) return;
	const activeItem = document.querySelector('.deped-fixed-header .itrack-management-submenu .nav-current') || document.querySelector('.deped-fixed-header .nav-current');
	const pageHeading = document.querySelector('main h1, .page h1, .shell h1, h1');
	const title = String((activeItem && (activeItem.dataset.navLabel || activeItem.textContent)) || (pageHeading && pageHeading.textContent) || document.title || 'Project i-Track')
		.replace(/^[^\p{L}\p{N}]+/u, '').replace(/▾\s*$/, '').trim();
	const titlebar = document.createElement('div');
	titlebar.id = 'itrack-page-titlebar';
	titlebar.className = 'itrack-page-titlebar';
	titlebar.innerHTML = '<span class="itrack-page-titlebar-marker" aria-hidden="true"></span><strong></strong><span class="itrack-school-year" aria-label="Active school year"></span><button class="itrack-header-signout" type="button">Sign Out <span aria-hidden="true">↪</span></button>';
	titlebar.querySelector('strong').textContent = title;
	const schoolYearParts = new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Manila', year:'numeric', month:'numeric' }).formatToParts(new Date());
	const schoolYear = Number(schoolYearParts.find((part) => part.type === 'year').value);
	const schoolMonth = Number(schoolYearParts.find((part) => part.type === 'month').value);
	const startYear = schoolMonth >= 6 ? schoolYear : schoolYear - 1;
	titlebar.querySelector('.itrack-school-year').textContent = `SY ${startYear}-${startYear + 1}`;
	titlebar.querySelector('.itrack-header-signout').addEventListener('click', () => {
		window.location.href = 'signout.html';
	});
	document.body.appendChild(titlebar);
}

function initializeSchoolYearFields() {
	const supportedPages = new Set([
		'account', 'dashboard', 'admin-students', 'learner', 'adm-request', 'approval-request',
		'approval', 'approved', 'learning-resources', 'reports', 'student-profile'
	]);
	if (!supportedPages.has(ITRACK_PAGE_KEY) || document.querySelector('.itrack-school-year-field')) return;
	const schoolYearParts = new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Manila', year:'numeric', month:'numeric' }).formatToParts(new Date());
	const year = Number(schoolYearParts.find((part) => part.type === 'year').value);
	const month = Number(schoolYearParts.find((part) => part.type === 'month').value);
	const startYear = month >= 6 ? year : year - 1;
	const field = document.createElement('section');
	field.className = 'itrack-school-year-field';
	field.setAttribute('aria-label', 'Current school year');
	field.innerHTML = '<label for="itrackActiveSchoolYear">School Year</label><input id="itrackActiveSchoolYear" type="text" readonly aria-readonly="true"><small>Automatically changes every June 1.</small>';
	field.querySelector('input').value = `${startYear}-${startYear + 1}`;
	const main = document.querySelector('main.shell, main.page, main, .shell, .page');
	if (main) main.prepend(field);
}

function dockNavigationInHeader(menuDock) {
	const navMenu = document.querySelector('.nav-menu');
	const navPanel = navMenu ? navMenu.closest('.nav-panel') : null;
	if (!navMenu || navMenu.parentNode === menuDock) {
		return Boolean(navMenu);
	}

	simplifyNavigation(navMenu);
	menuDock.appendChild(navMenu);
	if (navPanel) {
		navPanel.classList.add('nav-menu-is-docked');
	}
	return true;
}

function renderSidebarAccountProfile(user) {
	if (!user) return;
	const compactBar = document.querySelector('.deped-fixed-header .deped-compact-bar');
	const menuDock = document.querySelector('.deped-fixed-header .deped-compact-menu-dock');
	if (!compactBar || !menuDock) return;
	let card = document.getElementById('itrack-sidebar-account');
	if (!card) {
		card = document.createElement('section');
		card.id = 'itrack-sidebar-account';
		card.className = 'itrack-sidebar-account';
		card.setAttribute('aria-label', 'Signed-in account');
		card.innerHTML = '<div class="itrack-sidebar-avatar"><span></span></div><strong class="itrack-sidebar-account-name"></strong><small class="itrack-sidebar-account-role"></small><span class="itrack-sidebar-account-school"></span>';
		compactBar.insertBefore(card, menuDock);
	}
	const name = [user.firstname, user.middlename, user.lastname, user.extension_name].map((value) => String(value || '').trim()).filter(Boolean).join(' ') || user.school || 'Project i-Track User';
	const initials = [user.firstname, user.lastname].map((value) => String(value || '').trim().charAt(0)).filter(Boolean).join('').toUpperCase() || 'IT';
	const role = String(user.role || '').trim().toLowerCase();
	const roleLabel = role === 'teacher' ? 'School / Teacher Account' : role === 'admin' ? 'Administrator Account' : role === 'supervisor' ? 'District Supervisor Account' : role === 'principal' ? 'School Principal Account' : role === 'student' ? 'Student Account' : 'Authorized Account';
	const avatar = card.querySelector('.itrack-sidebar-avatar');
	avatar.replaceChildren();
	const initialsNode = document.createElement('span');
	initialsNode.textContent = initials;
	avatar.appendChild(initialsNode);
	if (String(user.profile_image || '').trim()) {
		const image = document.createElement('img');
		image.src = String(user.profile_image).trim();
		image.alt = `${name} profile picture`;
		image.addEventListener('error', () => image.remove(), { once:true });
		avatar.appendChild(image);
	}
	card.querySelector('.itrack-sidebar-account-name').textContent = name;
	card.querySelector('.itrack-sidebar-account-role').textContent = roleLabel;
	const school = card.querySelector('.itrack-sidebar-account-school');
	school.textContent = String(user.school || '').trim();
	school.hidden = !school.textContent;
}

window.addEventListener('itrack:user-updated', (event) => {
	if (event && event.detail) renderSidebarAccountProfile(event.detail);
});

function simplifyNavigation(navMenu) {
	const currentPage = String(window.location.pathname || '').split('/').pop().toLowerCase() || 'dashboard.html';
	const iconByLabel = [
		[/learner/i, '📋'], [/reports?/i, '📑'], [/dashboard/i, '📊'], [/account/i, '👤'], [/(adm|flp) request/i, '📄'],
		[/learning resource|module|activity sheet/i, '📚'], [/approval/i, '✅'], [/user/i, '👥'], [/create/i, '➕'], [/login/i, '🔐'], [/sign out/i, '↪']
	];
	let navItems = Array.from(navMenu.querySelectorAll('.nav-item'));
	navItems.forEach((item) => {
		const label = String(item.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
		if (/^adm request( form)?$/i.test(label)) item.textContent = 'FLP Request Form';
	});
	navItems.filter((item) => /^(create account|login page|approval portal|pending approvals?|approved users)$/i.test(String(item.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim())).forEach((item) => item.remove());
	navItems = Array.from(navMenu.querySelectorAll('.nav-item'));
	if (navItems.some((item) => /sign out/i.test(String(item.textContent || ''))) && !navItems.some((item) => /learning resources/i.test(String(item.textContent || '')))) {
		const resourcesItem = document.createElement('button');
		resourcesItem.type = 'button';
		resourcesItem.className = 'nav-item';
		resourcesItem.textContent = 'Learning Resources';
		resourcesItem.setAttribute('onclick', "window.location.href='learning-resources.html'");
		const greeting = navMenu.querySelector('.nav-greeting');
		const signOut = navItems.find((item) => /sign out/i.test(String(item.textContent || '')));
		navMenu.insertBefore(resourcesItem, greeting || signOut || null);
		navItems = Array.from(navMenu.querySelectorAll('.nav-item'));
	}
	const hasAdministratorNavigation = navItems.some((item) => /user management|adm approval|approval portal/i.test(String(item.textContent || '')));
	if (hasAdministratorNavigation) {
		const requiredAdministratorItems = [
			['Learner Record', 'learner.html'], ['Dashboard', 'dashboard.html'], ['FLP Request Form', 'adm-request.html'], ['ADM Approval', 'approval-request.html'],
			['Student Dashboard', 'admin-students.html'], ['Student Profile', 'student-profile.html'], ['Learning Resources', 'learning-resources.html'], ['Reports', 'reports.html'], ['User Management', 'user.html']
		];
		const currentLabels = () => Array.from(navMenu.querySelectorAll('.nav-item')).map((item) => String(item.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase());
		requiredAdministratorItems.forEach(([label, target]) => {
			if (currentLabels().includes(label.toLowerCase())) return;
			const item = document.createElement('button');
			item.type = 'button';
			item.className = 'nav-item nav-admin-only';
			item.textContent = label;
			item.setAttribute('onclick', `window.location.href='${target}'`);
			navMenu.appendChild(item);
		});
		if (!navMenu.querySelector('.nav-greeting')) {
			const greeting = document.createElement('span');
			greeting.id = 'navGreeting';
			greeting.className = 'nav-greeting';
			navMenu.appendChild(greeting);
		}
		if (!Array.from(navMenu.querySelectorAll('.nav-item')).some((item) => /sign out/i.test(String(item.textContent || '')))) {
			const signOut = document.createElement('button');
			signOut.type = 'button';
			signOut.className = 'nav-item nav-item-signout';
			signOut.textContent = 'Sign Out';
			signOut.setAttribute('onclick', "window.location.href='signout.html'");
			navMenu.appendChild(signOut);
		}
		const administratorOrder = ['Learner Record', 'Dashboard', 'FLP Request Form', 'ADM Approval', 'Student Dashboard', 'Student Profile', 'Learning Resources', 'Reports', 'User Management'];
		const orderAnchor = navMenu.querySelector('.nav-greeting, .nav-item-signout');
		administratorOrder.forEach((label) => {
			const item = Array.from(navMenu.querySelectorAll('.nav-item')).find((candidate) => String(candidate.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase() === label.toLowerCase());
			if (item) navMenu.insertBefore(item, orderAnchor || null);
		});
		navMenu.querySelectorAll('.nav-dropdown').forEach((group) => { if (!group.querySelector('.nav-item')) group.remove(); });
		navItems = Array.from(navMenu.querySelectorAll('.nav-item'));
	}
	const accountGreeting = navMenu.querySelector('.nav-greeting');
	if (accountGreeting) accountGreeting.hidden = true;
	fetch('/api/auth/me', { credentials: 'include' }).then((response) => response.ok ? response.json() : null).then((payload) => {
			const user = payload && payload.user;
			renderSidebarAccountProfile(user);
			const role = String((user && user.role) || '').trim().toLowerCase();
			if (role === 'student' && !navMenu.dataset.studentNavigationLoaded) {
				navMenu.dataset.studentNavigationLoaded = 'true';
				const studentItems = [
					['Student Profile', 'student-profile.html'],
					['Learning Resources', 'learning-resources.html']
				];
				const allowed = new Set(studentItems.map(([label]) => label.toLowerCase()));
				Array.from(navMenu.querySelectorAll('.nav-item')).forEach((item) => {
					const label = String(item.dataset.navLabel || item.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
					if (!allowed.has(label)) item.remove();
				});
				const existing = () => Array.from(navMenu.querySelectorAll('.nav-item')).map((item) =>
					String(item.dataset.navLabel || item.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase()
				);
				studentItems.forEach(([label, target]) => {
					if (existing().includes(label.toLowerCase())) return;
					const item = document.createElement('button');
					item.type = 'button';
					item.className = 'nav-item';
					item.textContent = label;
					item.setAttribute('onclick', `window.location.href='${target}'`);
					navMenu.appendChild(item);
				});
				navMenu.querySelectorAll('.nav-dropdown,.itrack-management-menu').forEach((group) => { if (!group.querySelector('.nav-item')) group.remove(); });
				simplifyNavigation(navMenu);
				return;
			}
			if (role === 'teacher' && !navMenu.dataset.teacherNavigationLoaded) {
				navMenu.dataset.teacherNavigationLoaded = 'true';
				const teacherItems = [
					['Learner Record', 'learner.html'],
					['Student Dashboard', 'admin-students.html'],
					['Learning Resources', 'learning-resources.html'],
					['My Account', 'account.html']
				];
				const allowed = new Set(teacherItems.map(([label]) => label.toLowerCase()));
				Array.from(navMenu.querySelectorAll('.nav-item')).forEach((item) => {
					const label = String(item.dataset.navLabel || item.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
					if (!allowed.has(label)) item.remove();
				});
				const existing = () => Array.from(navMenu.querySelectorAll('.nav-item')).map((item) =>
					String(item.dataset.navLabel || item.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase()
				);
				teacherItems.forEach(([label, target]) => {
					if (existing().includes(label.toLowerCase())) return;
					const item = document.createElement('button');
					item.type = 'button';
					item.className = 'nav-item';
					item.textContent = label;
					item.setAttribute('onclick', `window.location.href='${target}'`);
					navMenu.appendChild(item);
				});
				teacherItems.forEach(([, target]) => {
					const item = Array.from(navMenu.querySelectorAll('.nav-item')).find((candidate) => String(candidate.getAttribute('onclick') || candidate.getAttribute('href') || '').toLowerCase().includes(target));
					if (item) navMenu.appendChild(item);
				});
				navMenu.querySelectorAll('.nav-dropdown,.itrack-management-menu').forEach((group) => { if (!group.querySelector('.nav-item')) group.remove(); });
				simplifyNavigation(navMenu);
				return;
			}
			if ((role === 'supervisor' || role === 'principal') && !navMenu.dataset.leadershipNavigationLoaded) {
				navMenu.dataset.leadershipNavigationLoaded = 'true';
				const leadershipItems = role === 'supervisor'
					? [['District Dashboard', 'dashboard.html'], ['District Reports', 'reports.html'], ['My Account', 'account.html']]
					: [['FLP Request Form', 'adm-request.html'], ['Student Dashboard', 'admin-students.html'], ['School Reports', 'reports.html'], ['My Account', 'account.html']];
				const allowedTargets = new Set(leadershipItems.map(([, target]) => target.toLowerCase()));
				Array.from(navMenu.querySelectorAll('.nav-item')).forEach((item) => {
					const action = String(item.getAttribute('onclick') || item.getAttribute('href') || '').toLowerCase();
					const target = (action.match(/([a-z0-9-]+\.html)/i) || [])[1] || '';
					if (!allowedTargets.has(target) && !/sign out/i.test(String(item.textContent || ''))) item.remove();
				});
				leadershipItems.forEach(([label, target]) => {
					if (Array.from(navMenu.querySelectorAll('.nav-item')).some((item) => String(item.getAttribute('onclick') || '').toLowerCase().includes(target))) return;
					const item = document.createElement('button');
					item.type = 'button';
					item.className = 'nav-item';
					item.textContent = label;
					item.setAttribute('onclick', `window.location.href='${target}'`);
					const signOut = Array.from(navMenu.querySelectorAll('.nav-item')).find((candidate) => /sign out/i.test(String(candidate.textContent || '')));
					navMenu.insertBefore(item, signOut || null);
				});
				const leadershipAnchor = Array.from(navMenu.querySelectorAll('.nav-item')).find((item) => /sign out/i.test(String(item.textContent || ''))) || null;
				leadershipItems.forEach(([, target]) => {
					const item = Array.from(navMenu.querySelectorAll('.nav-item')).find((candidate) => String(candidate.getAttribute('onclick') || candidate.getAttribute('href') || '').toLowerCase().includes(target));
					if (item) navMenu.insertBefore(item, leadershipAnchor);
				});
				navMenu.querySelectorAll('.nav-dropdown,.itrack-management-menu').forEach((group) => group.remove());
				simplifyNavigation(navMenu);
				return;
			}
			if (role === 'admin' && !navMenu.dataset.adminNavigationLoaded) {
				navMenu.dataset.adminNavigationLoaded = 'true';
				const adminItems = [
					['Learner Record', 'learner.html'], ['Dashboard', 'dashboard.html'], ['FLP Request Form', 'adm-request.html'], ['ADM Approval', 'approval-request.html'],
					['Student Dashboard', 'admin-students.html'], ['Student Profile', 'student-profile.html'], ['Learning Resources', 'learning-resources.html'], ['Reports', 'reports.html'], ['User Management', 'user.html']
				];
				const existing = () => Array.from(navMenu.querySelectorAll('.nav-item')).map((item) =>
					String(item.dataset.navLabel || item.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase()
				);
				adminItems.forEach(([label, target]) => {
					if (existing().includes(label.toLowerCase())) return;
					const item = document.createElement('button');
					item.type = 'button';
					item.className = 'nav-item nav-admin-only';
					item.textContent = label;
					item.setAttribute('onclick', `window.location.href='${target}'`);
					const signOut = Array.from(navMenu.children).find((child) => /sign out/i.test(String(child.textContent || '')));
					navMenu.insertBefore(item, signOut || null);
				});
				const learnerMenu = navMenu.querySelector(':scope > .itrack-learner-menu');
				if (learnerMenu) {
					learnerMenu.querySelectorAll('.itrack-learner-submenu > .nav-item').forEach((item) => navMenu.insertBefore(item, learnerMenu));
					learnerMenu.remove();
				}
				simplifyNavigation(navMenu);
			}
		}).catch(() => {}).finally(() => document.documentElement.classList.add('itrack-nav-role-ready'));

	Array.from(navMenu.querySelectorAll('.nav-item')).filter((item) => /sign out/i.test(String(item.textContent || ''))).forEach((item) => item.remove());
	navItems = Array.from(navMenu.querySelectorAll('.nav-item'));

	navItems.forEach((item) => {
		let cleanLabel = String(item.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
		if (/^(adm|flp) request( form)?$/i.test(cleanLabel)) cleanLabel = 'FLP Request Form';
		if (cleanLabel) {
			const icon = (iconByLabel.find(([pattern]) => pattern.test(cleanLabel)) || [null, '•'])[1];
			const iconSpan = document.createElement('span');
			iconSpan.className = 'nav-item-icon';
			iconSpan.textContent = icon;
			iconSpan.setAttribute('aria-hidden', 'true');
			item.replaceChildren(iconSpan, document.createTextNode(cleanLabel));
			item.dataset.navLabel = cleanLabel;
		}

		const action = String(item.getAttribute('onclick') || item.getAttribute('href') || '').toLowerCase();
		item.classList.toggle('nav-current', action.includes(currentPage));
	});

	const dashboardItem = navItems.find((item) => /^dashboard$/i.test(String(item.dataset.navLabel || '')));
	const flpRequestItem = navItems.find((item) => /^flp request form$/i.test(String(item.dataset.navLabel || '')));
	if (dashboardItem && flpRequestItem) dashboardItem.insertAdjacentElement('afterend', flpRequestItem);
	const admApprovalItem = navItems.find((item) => /^adm approval$/i.test(String(item.dataset.navLabel || '')));
	if (flpRequestItem && admApprovalItem) flpRequestItem.insertAdjacentElement('afterend', admApprovalItem);

	const managementPattern = /user management/i;
	const managementItems = navItems.filter((item) => managementPattern.test(String(item.dataset.navLabel || '')));
	if (!managementItems.length) return;
	if (managementItems.length === 1) return;

	const previousGroups = new Set(managementItems.map((item) => item.closest('.nav-dropdown')).filter(Boolean));
	const managementMenu = document.createElement('div');
	managementMenu.className = 'itrack-management-menu';

	const managementToggle = document.createElement('button');
	managementToggle.type = 'button';
	managementToggle.className = 'nav-item itrack-management-toggle';
	managementToggle.setAttribute('aria-expanded', 'false');
	managementToggle.setAttribute('aria-haspopup', 'true');
	managementToggle.innerHTML = '<span class="nav-item-icon" aria-hidden="true">⚙️</span>User Management<span class="management-caret" aria-hidden="true">▾</span>';

	const managementSubmenu = document.createElement('div');
	managementSubmenu.className = 'itrack-management-submenu';
	managementSubmenu.setAttribute('aria-label', 'User Management submenu');
	managementItems.forEach((item) => managementSubmenu.appendChild(item));

	if (managementItems.some((item) => item.classList.contains('nav-current'))) {
		managementToggle.classList.add('nav-current');
	}

	managementMenu.appendChild(managementToggle);
	managementMenu.appendChild(managementSubmenu);
	const greeting = navMenu.querySelector('.nav-greeting');
	const signOut = Array.from(navMenu.querySelectorAll('.nav-item')).find((item) => /sign out/i.test(String(item.dataset.navLabel || '')));
	navMenu.insertBefore(managementMenu, greeting || signOut || null);

	previousGroups.forEach((group) => {
		if (!group.querySelector('.nav-item')) group.remove();
	});

	managementToggle.addEventListener('click', (event) => {
		event.stopPropagation();
		const isOpen = managementMenu.classList.toggle('is-open');
		managementToggle.setAttribute('aria-expanded', String(isOpen));
	});

	document.addEventListener('click', (event) => {
		if (!managementMenu.contains(event.target)) {
			managementMenu.classList.remove('is-open');
			managementToggle.setAttribute('aria-expanded', 'false');
		}
	});
}

function initializeMobileNavigation(header, menuToggle, menuDock) {
	function setOpen(open) {
		header.classList.toggle('mobile-menu-open', open);
		menuToggle.setAttribute('aria-expanded', String(open));
		menuToggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
	}

	menuToggle.addEventListener('click', () => {
		setOpen(!header.classList.contains('mobile-menu-open'));
	});

	menuDock.addEventListener('click', (event) => {
		if (event.target.closest('.itrack-management-toggle')) return;
		if (event.target.closest('a, button')) {
			setOpen(false);
		}
	});

	document.addEventListener('click', (event) => {
		if (!header.contains(event.target)) {
			setOpen(false);
		}
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			setOpen(false);
			menuToggle.focus();
		}
	});

	window.addEventListener('resize', () => {
		if (window.innerWidth > 1024) {
			setOpen(false);
		}
	}, { passive: true });
}

function initializeModularLearningTracker() {
	if (ITRACK_PAGE_KEY !== 'admin-students' || document.getElementById('modularTracker')) return;
	const hero = document.querySelector('main .hero');
	if (!hero) return;
	const style = document.createElement('style');
	style.textContent = '.modular-tracker{margin:16px 0;padding:18px;border:1px solid #cfe0e5;border-radius:16px;background:linear-gradient(145deg,#fff,#f3f9fb);box-shadow:0 9px 25px rgba(16,47,73,.06)}.modular-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}.modular-head h2{margin:0 0 4px;color:#123b58}.modular-head p{margin:0;color:#687c82;font-size:.82rem}.term-filter{display:flex;gap:6px;flex-wrap:wrap}.term-filter button{min-height:35px;padding:6px 11px;border:1px solid #b8d2df;border-radius:999px;background:#fff;color:#275b77;font:600 .75rem Poppins,sans-serif;cursor:pointer}.term-filter button.active{border-color:#176f9d;background:#176f9d;color:#fff}.modular-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:9px}.modular-stat{padding:12px;border:1px solid #dbe8eb;border-radius:12px;background:#fff}.modular-stat span{display:block;color:#687c82;font-size:.67rem;text-transform:uppercase}.modular-stat strong{display:block;margin-top:4px;color:#113d5a;font-size:1.35rem}.modular-stat.followup{border-left:4px solid #e3aa2f}.completion-track{height:8px;margin-top:10px;border-radius:999px;background:#e4eeed;overflow:hidden}.completion-track i{display:block;height:100%;width:0;background:#268d6d;transition:width .35s ease}.modular-completion-text{margin-top:5px;color:#687c82;font-size:.7rem}.modular-activity{margin-top:14px;border-top:1px solid #dce8ea;padding-top:12px}.modular-activity h3{margin:0 0 8px;font-size:.86rem}.modular-activity-list{display:grid;gap:7px;max-height:190px;overflow:auto}.modular-event{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;padding:9px 11px;border-radius:10px;background:#fff;border:1px solid #e0eaec;font-size:.74rem}.modular-event small{display:block;color:#71817c}.module-status{font-weight:600}.module-status.done{color:#147556}.module-status.ongoing{color:#936600}.module-status.assigned{color:#536a77}@media(max-width:980px){.modular-metrics{grid-template-columns:repeat(3,1fr)}}@media(max-width:650px){.modular-head{flex-direction:column}.modular-metrics{grid-template-columns:repeat(2,1fr)}}';
	style.textContent += '.modular-student-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px;max-height:520px;overflow:auto;padding:2px}.modular-student-card{overflow:hidden;border:1px solid #d5e4e7;border-radius:15px;background:#fff;box-shadow:0 7px 18px rgba(16,47,73,.06)}.modular-student-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:13px 14px;background:linear-gradient(135deg,#eff8fb,#f5fbf8)}.modular-student-head h4{margin:0;color:#123b58;font-size:.86rem}.modular-student-head small{display:block;margin-top:3px;color:#6d7f84;font-size:.65rem}.modular-online{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:999px;background:#dbf5e7;color:#087347;font-size:.64rem;font-weight:800}.modular-online.offline{background:#edf2f4;color:#657982}.modular-online i{width:7px;height:7px;border-radius:50%;background:currentColor}.modular-student-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;padding:11px 13px}.modular-student-metric{padding:8px;border-radius:9px;background:#f5f9f9;text-align:center}.modular-student-metric span{display:block;color:#6d8085;font-size:.55rem;text-transform:uppercase}.modular-student-metric strong{display:block;margin-top:2px;color:#123b58;font-size:.98rem}.modular-student-progress{height:6px;margin:0 13px 10px;border-radius:999px;background:#e3edeb;overflow:hidden}.modular-student-progress i{display:block;height:100%;background:#268d6d}.modular-student-events{display:grid;gap:6px;padding:0 13px 13px}.modular-student-event{display:flex;justify-content:space-between;gap:9px;padding:8px 9px;border:1px solid #e2ebed;border-radius:9px;font-size:.66rem}.modular-student-event small{display:block;color:#71817c}.modular-student-empty{padding:13px;color:#71817c;font-size:.7rem;text-align:center}@media(max-width:650px){.modular-student-list{grid-template-columns:1fr}.modular-student-metrics{grid-template-columns:repeat(2,1fr)}}';
	document.head.appendChild(style);
	const tracker = document.createElement('section');
	tracker.id = 'modularTracker';
	tracker.className = 'modular-tracker';
	tracker.setAttribute('aria-labelledby', 'modularTrackerTitle');
	tracker.innerHTML = '<div class="modular-head"><div><h2 id="modularTrackerTitle">📘 Modular Learning Tracker</h2><p>Monitor student module participation and completion by school term.</p></div><div id="modularTermFilter" class="term-filter"><button type="button" class="active" data-term="all">All Terms</button><button type="button" data-term="1">Term 1</button><button type="button" data-term="2">Term 2</button><button type="button" data-term="3">Term 3</button></div></div><div class="modular-metrics"><article class="modular-stat"><span>Total Modules</span><strong id="modularTotal">0</strong></article><article class="modular-stat"><span>Assigned</span><strong id="modularAssigned">0</strong></article><article class="modular-stat"><span>Ongoing</span><strong id="modularOngoing">0</strong></article><article class="modular-stat"><span>Completed</span><strong id="modularCompleted">0</strong></article><article class="modular-stat"><span>Active Students</span><strong id="modularStudents">0</strong></article><article class="modular-stat followup"><span>Need Follow-up</span><strong id="modularFollowup">0</strong></article></div><div class="completion-track" aria-label="Module completion rate"><i id="modularCompletionBar"></i></div><div id="modularCompletionText" class="modular-completion-text">0% module completion</div><div class="modular-activity"><h3>Student Learning Containers</h3><div id="modularStudentList" class="modular-student-list"><div class="empty">Loading enrolled students…</div></div></div>';
	const onlineStyle = document.createElement('style');
	onlineStyle.textContent = '.modular-online-total{display:inline-flex;align-items:center;gap:6px;min-height:35px;padding:6px 11px;border:1px solid #91d4b2;border-radius:999px;background:#def6e9;color:#087347;font:800 .72rem Poppins,sans-serif;white-space:nowrap;box-shadow:0 5px 13px rgba(8,115,71,.1)}.modular-online-total i{width:8px;height:8px;border-radius:50%;background:#13a464;box-shadow:0 0 0 4px rgba(19,164,100,.13)}.modular-online-total strong{font-size:.9rem}';
	document.head.appendChild(onlineStyle);
	const onlineCounter = document.createElement('span');
	onlineCounter.className = 'modular-online-total';
	onlineCounter.title = 'Student accounts active within the last 75 seconds';
	onlineCounter.innerHTML = '<i></i><strong id="modularOnlineStudents">0</strong> Students Online';
	tracker.querySelector('[data-term="all"]').insertAdjacentElement('afterend', onlineCounter);
	hero.insertAdjacentElement('afterend', tracker);
	const byId = (id) => document.getElementById(id);
	const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character]));
	let data = null;
	let activeTerm = 'all';
	const render = () => {
		if (!data) return;
		const item = activeTerm === 'all' ? data.all : ((data.terms || {})[activeTerm] || {});
		[['modularTotal','total'],['modularAssigned','assigned'],['modularOngoing','ongoing'],['modularCompleted','completed'],['modularStudents','participating'],['modularFollowup','needsFollowUp']].forEach(([id,key]) => { byId(id).textContent = Number(item[key] || 0); });
		const rate = Number(item.completionRate || 0);
		byId('modularCompletionBar').style.width = Math.max(0, Math.min(100, rate)) + '%';
		byId('modularCompletionText').textContent = rate.toFixed(1) + '% module completion';
		const students = data.students || [];
		byId('modularOnlineStudents').textContent = students.filter((student) => student.presence && student.presence.online).length;
		byId('modularStudentList').innerHTML = students.length ? students.map((student) => { const summary = activeTerm === 'all' ? student.all : ((student.terms || {})[activeTerm] || {}), activities = (student.activities || []).filter((entry) => activeTerm === 'all' || String(entry.term) === activeTerm).slice(0, 4), online = Boolean(student.presence && student.presence.online); return '<article class="modular-student-card"><header class="modular-student-head"><div><h4>' + escapeHtml(student.name) + '</h4><small>LRN: ' + escapeHtml(student.lrn || '—') + ' · ' + escapeHtml(student.school || 'No school') + '</small></div><span class="modular-online ' + (online ? '' : 'offline') + '"><i></i>' + (online ? 'Online' : 'Offline') + '</span></header><div class="modular-student-metrics"><div class="modular-student-metric"><span>Total</span><strong>' + Number(summary.total || 0) + '</strong></div><div class="modular-student-metric"><span>Assigned</span><strong>' + Number(summary.assigned || 0) + '</strong></div><div class="modular-student-metric"><span>Ongoing</span><strong>' + Number(summary.ongoing || 0) + '</strong></div><div class="modular-student-metric"><span>Completed</span><strong>' + Number(summary.completed || 0) + '</strong></div></div><div class="modular-student-progress"><i style="width:' + Number(summary.completionRate || 0) + '%"></i></div><div class="modular-student-events">' + (activities.length ? activities.map((entry) => '<div class="modular-student-event"><span><strong>Term ' + Number(entry.term) + ' · Module ' + Number(entry.moduleNumber) + '</strong><small>' + escapeHtml(entry.title) + '</small></span><span class="module-status ' + escapeHtml(entry.status) + '">' + (entry.status === 'done' ? '✓ Completed' : entry.status === 'ongoing' ? '● Ongoing' : 'Assigned') + '</span></div>').join('') : '<div class="modular-student-empty">No learning activity for this term.</div>') + '</div></article>'; }).join('') : '<div class="empty">No enrolled student accounts found.</div>';
	};
	const load = async () => {
		try {
			const response = await fetch('/api/admin/modular-tracking-summary', { credentials:'include' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(payload.message || 'Unable to load modular tracker.');
			data = payload;
			render();
		} catch (error) {
			byId('modularStudentList').innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
		}
	};
	byId('modularTermFilter').addEventListener('click', (event) => {
		const button = event.target.closest('[data-term]');
		if (!button) return;
		activeTerm = button.dataset.term;
		byId('modularTermFilter').querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
		render();
	});
	load();
	setInterval(load, 60000);
}

function initializeStudentModularTracker() {
	if (ITRACK_PAGE_KEY !== 'student-profile' || document.getElementById('studentModularTracker')) return;
	const profilePanel = document.querySelector('main .panel');
	if (!profilePanel) return;
	fetch('/api/auth/me', { credentials:'include' }).then((response) => response.ok ? response.json() : null).then((payload) => {
		if (String(payload && payload.user && payload.user.role || '').toLowerCase() !== 'student') return;
		const style = document.createElement('style');
		style.textContent = '.student-modular-tracker{position:relative;overflow:hidden;margin:0 0 16px;padding:0 18px 18px;border:1px solid #c9dfe6;border-radius:19px;background:#f5fafc;box-shadow:0 14px 34px rgba(16,47,73,.09)}.student-tracker-head{display:flex;justify-content:space-between;align-items:center;gap:14px;margin:0 -18px 16px;padding:17px 18px;background:linear-gradient(115deg,#0f5888,#1688aa);color:#fff}.student-tracker-head h2{margin:0 0 4px;color:#fff}.student-tracker-head p{margin:0;color:#dceff7;font-size:.82rem}.student-term-filter{display:flex;gap:6px;flex-wrap:wrap}.student-term-filter button{min-height:34px;padding:6px 11px;border:1px solid rgba(255,255,255,.5);border-radius:999px;background:rgba(255,255,255,.12);color:#fff;font:700 .72rem Manrope,sans-serif;cursor:pointer;transition:.2s ease}.student-term-filter button:hover{background:rgba(255,255,255,.22)}.student-term-filter button.active{background:#ffda62;border-color:#ffda62;color:#173b55;box-shadow:0 5px 13px rgba(0,0,0,.16)}.student-progress-layout{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) minmax(225px,1.35fr);gap:10px}.student-progress-stat,.student-progress-summary{padding:14px;border:1px solid #d8e6ea;border-radius:14px;background:#fff;box-shadow:0 5px 14px rgba(16,47,73,.045)}.student-progress-stat{position:relative;border-top:4px solid #75b6df}.student-progress-stat.assigned{border-top-color:#efc85c;background:#fffdf7}.student-progress-stat.ongoing{border-top-color:#8c7ad0;background:#fbfaff}.student-progress-stat.completed{border-top-color:#61ba92;background:#f8fdfb}.student-progress-stat span{display:block;color:#687c82;font-size:.66rem;font-weight:700;text-transform:uppercase}.student-progress-stat strong{display:block;margin-top:5px;color:#113d5a;font-size:1.5rem}.student-progress-summary{display:grid;grid-template-columns:72px 1fr;align-items:center;gap:11px}.student-progress-ring{display:grid;place-items:center;width:72px;aspect-ratio:1;border-radius:50%;background:conic-gradient(#268d6d 0%,#e3edeb 0);transition:background .35s ease}.student-progress-ring::after{content:"";width:53px;aspect-ratio:1;border-radius:50%;background:#fff}.student-progress-ring strong{position:absolute;color:#147556;font-size:.78rem}.student-progress-copy{display:grid;gap:5px}.student-progress-copy b{color:#123b58;font-size:.78rem}.student-progress-copy span{color:#687c82;font-size:.7rem}.student-next-modules{display:grid;gap:8px;margin-top:14px}.student-next-modules:not(:empty)::before{content:"Activities that need attention";color:#123b58;font-size:.76rem;font-weight:800}.student-next-module{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid #dce8eb;border-left:4px solid #efc85c;border-radius:11px;background:#fff;font-size:.74rem}.student-next-module.ongoing{border-left-color:#8c7ad0}.student-next-module small{display:block;margin-top:2px;color:#71817c}.student-next-module a{align-self:center;padding:7px 10px;border-radius:8px;background:#e8f4f8;color:#126e91;font-weight:800;text-decoration:none;white-space:nowrap}.student-next-module a:hover{background:#d8edf4}@media(max-width:980px){.student-progress-layout{grid-template-columns:repeat(2,1fr)}.student-progress-summary{grid-column:1/-1}}@media(max-width:680px){.student-tracker-head{align-items:flex-start;flex-direction:column}.student-progress-layout{grid-template-columns:1fr 1fr}.student-progress-summary{grid-template-columns:64px 1fr}.student-progress-ring{width:64px}.student-progress-ring::after{width:47px}.student-next-module{align-items:flex-start;flex-direction:column}.student-next-module a{align-self:stretch;text-align:center}}';
		style.textContent += '.student-progress-ring{position:relative}';
		document.head.appendChild(style);
		const tracker = document.createElement('section');
		tracker.id = 'studentModularTracker';
		tracker.className = 'student-modular-tracker';
		tracker.innerHTML = '<div class="student-tracker-head"><div><h2>📘 My Modular Progress</h2><p>Track your assigned modules and continue the activities that need attention.</p></div><div id="studentTermFilter" class="student-term-filter"><button class="active" type="button" data-term="all">All Terms</button><button type="button" data-term="1">Term 1</button><button type="button" data-term="2">Term 2</button><button type="button" data-term="3">Term 3</button></div></div><div class="student-progress-layout"><article class="student-progress-stat"><span>Total Modules</span><strong id="studentTrackerTotal">0</strong></article><article class="student-progress-stat assigned"><span>Assigned</span><strong id="studentTrackerAssigned">0</strong></article><article class="student-progress-stat ongoing"><span>Ongoing</span><strong id="studentTrackerOngoing">0</strong></article><article class="student-progress-stat completed"><span>Completed</span><strong id="studentTrackerCompleted">0</strong></article><article class="student-progress-summary"><div id="studentTrackerRing" class="student-progress-ring"><strong id="studentTrackerRate">0%</strong></div><div class="student-progress-copy"><b>Overall completion</b><span id="studentTrackerMessage">Your modular activities will appear here.</span></div></article></div><div id="studentNextModules" class="student-next-modules"></div>';
		profilePanel.insertAdjacentElement('afterend', tracker);
		const byId = (id) => document.getElementById(id);
		const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character]));
		let resources = [];
		let activeTerm = 'all';
		const render = () => {
			const scoped = resources.filter((item) => activeTerm === 'all' || String(Number(item.term || 1)) === activeTerm);
			const assigned = scoped.filter((item) => String(item.status || 'assigned') === 'assigned');
			const ongoing = scoped.filter((item) => String(item.status || '') === 'ongoing');
			const completed = scoped.filter((item) => String(item.status || '') === 'done');
			const rate = scoped.length ? Math.round((completed.length / scoped.length) * 1000) / 10 : 0;
			byId('studentTrackerTotal').textContent = scoped.length;
			byId('studentTrackerAssigned').textContent = assigned.length;
			byId('studentTrackerOngoing').textContent = ongoing.length;
			byId('studentTrackerCompleted').textContent = completed.length;
			byId('studentTrackerRate').textContent = rate.toFixed(1) + '%';
			byId('studentTrackerRing').style.background = 'conic-gradient(#268d6d 0 ' + rate + '%,#e3edeb ' + rate + '% 100%)';
			byId('studentTrackerMessage').textContent = ongoing.length ? 'Continue your ongoing module.' : assigned.length ? 'You have modules ready to answer.' : scoped.length ? 'All activities in this view are completed.' : 'No modules assigned for this term.';
			const next = ongoing.concat(assigned).slice(0, 4);
			byId('studentNextModules').innerHTML = next.length ? next.map((item) => '<div class="student-next-module ' + (item.status === 'ongoing' ? 'ongoing' : '') + '"><span><strong>Term ' + Number(item.term || 1) + ' · ' + escapeHtml(item.resource_type || 'Module') + ' ' + Number(item.module_number || 1) + '</strong><small>' + escapeHtml(item.title || 'Learning activity') + ' · ' + (item.status === 'ongoing' ? 'Ongoing' : 'Ready to answer') + '</small></span><a href="learning-resources.html">' + (item.status === 'ongoing' ? 'Continue →' : 'Answer now →') + '</a></div>').join('') : '';
		};
		byId('studentTermFilter').addEventListener('click', (event) => {
			const button = event.target.closest('[data-term]');
			if (!button) return;
			activeTerm = button.dataset.term;
			byId('studentTermFilter').querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
			render();
		});
		const load = () => fetch('/api/learning-resources', { credentials:'include' }).then((response) => response.json().then((data) => ({ response, data }))).then(({ response, data }) => {
			if (!response.ok) throw new Error(data.message || 'Unable to load modular progress.');
			resources = Array.isArray(data.resources) ? data.resources : [];
			render();
		}).catch((error) => { byId('studentTrackerMessage').textContent = error.message; });
		load();
		setInterval(load, 60000);
	}).catch(() => {});
}

function initializeCreateAccountPopover() {
	if (new URLSearchParams(window.location.search).get('embed') === '1') return;
	if (document.getElementById('itrack-account-popover')) return;
	const popover = document.createElement('section');
	popover.id = 'itrack-account-popover';
	popover.className = 'itrack-account-popover';
	popover.setAttribute('aria-label', 'Create an account');
	popover.innerHTML = '<h2>Create a School Account</h2><p>Registration for teachers and authorized school staff.</p><div class="itrack-account-choices"><button type="button" data-account-type="school"><span aria-hidden="true">▣</span><strong>Create School Account</strong><small>For teachers and authorized school personnel</small></button></div>';
	document.body.appendChild(popover);
	const overlay = document.createElement('div');
	overlay.className = 'itrack-account-overlay';
	overlay.innerHTML = '<div class="itrack-account-frame"><button class="itrack-account-frame-close" type="button" aria-label="Close create account window">×</button><iframe title="Create account form"></iframe></div>';
	document.body.appendChild(overlay);
	const frame = overlay.querySelector('iframe');
	const closeOverlay = () => { overlay.classList.remove('is-open'); frame.removeAttribute('src'); };
	const openAccountForm = (type) => { frame.src = 'create.html?embed=1&type=' + encodeURIComponent(type); overlay.classList.add('is-open'); };
	overlay.querySelector('.itrack-account-frame-close').addEventListener('click', closeOverlay);
	overlay.addEventListener('click', (event) => { if (event.target === overlay) closeOverlay(); });
	window.addEventListener('message', (event) => {
		if (event.data === 'itrack-account-created') closeOverlay();
		if (event.data === 'itrack-account-cancelled') window.location.href = 'index.html';
	});
	function positionPopover(trigger) {
		const rect = trigger.getBoundingClientRect();
		const halfWidth = Math.min(340, Math.max(140, (window.innerWidth - 24) / 2));
		const center = Math.max(halfWidth + 12, Math.min(rect.left + rect.width / 2, window.innerWidth - halfWidth - 12));
		popover.style.setProperty('--popover-left', center + 'px');
		popover.style.setProperty('--popover-top', Math.min(rect.bottom + 10, window.innerHeight - 245) + 'px');
	}
	document.addEventListener('click', (event) => {
		const trigger = event.target.closest('a,button');
		const directType = trigger && trigger.dataset.openAccountType;
		if (directType === 'school') {
			event.preventDefault(); event.stopImmediatePropagation(); popover.classList.remove('is-open'); openAccountForm(directType); return;
		}
		if (trigger && /create account/i.test(String(trigger.dataset.navLabel || trigger.textContent || '')) && !trigger.closest('.itrack-account-popover')) {
			event.preventDefault(); event.stopImmediatePropagation(); positionPopover(trigger); popover.classList.toggle('is-open'); return;
		}
		if (!popover.contains(event.target)) popover.classList.remove('is-open');
	}, true);
	popover.addEventListener('click', (event) => {
		const choice = event.target.closest('[data-account-type]'); if (!choice) return;
		popover.classList.remove('is-open'); openAccountForm(choice.dataset.accountType);
	});
	document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { popover.classList.remove('is-open'); closeOverlay(); } });
}

function enforceRequiredFields(root = document) {
	const controls = root.querySelectorAll
		? root.querySelectorAll('input, select, textarea')
		: [];

	controls.forEach((control) => {
		const type = String(control.getAttribute('type') || '').toLowerCase();
		const excludedTypes = ['hidden', 'button', 'submit', 'reset', 'image'];
		const isChoiceControl = type === 'checkbox' || type === 'radio';

		if (
			excludedTypes.includes(type) ||
			control.disabled ||
			control.readOnly ||
			isChoiceControl
		) {
			return;
		}

		control.required = true;
		control.setAttribute('aria-required', 'true');

		let label = null;
		if (control.id) {
			label = document.querySelector('label[for="' + CSS.escape(control.id) + '"]');
		}
		if (!label) {
			label = control.closest('label');
		}
		if (!label) {
			const fieldContainer = control.closest('.form-group, .form-field, .field, .input-group, .filter-group');
			label = fieldContainer ? fieldContainer.querySelector('label') : null;
		}

		if (label && !label.querySelector('.required-marker, .required-mark')) {
			const marker = document.createElement('span');
			marker.className = 'required-marker';
			marker.textContent = ' *';
			marker.setAttribute('aria-hidden', 'true');
			label.appendChild(marker);
		}
	});
}

function initializeRequiredFields() {
	enforceRequiredFields(document);

	const observer = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			mutation.addedNodes.forEach((node) => {
				if (node.nodeType === Node.ELEMENT_NODE) {
					enforceRequiredFields(node);
				}
			});
		});
	});

	observer.observe(document.body, { childList: true, subtree: true });
}

class ThemeManager {
	constructor() {
		this.THEME_KEY = 'adm-dashboard-theme';
		this.THEME_DB_KEY = 'theme_preference';
		this.init();
	}

	init() {
		// Load theme from localStorage immediately to avoid flicker
		const savedTheme = this.loadFromStorage();
		if (savedTheme) {
			this.setTheme(savedTheme);
		} else {
			// Check system preference
			const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			this.setTheme(prefersDark ? 'dark' : 'light');
		}

		// Create and setup theme toggle button
		this.createThemeToggle();

		// Add listener for system theme changes
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
			if (!localStorage.getItem(this.THEME_KEY)) {
				this.setTheme(e.matches ? 'dark' : 'light');
			}
		});

		// Load theme from database when user is authenticated
		this.loadFromDatabase();
	}

	setTheme(theme) {
		if (theme === 'dark' || theme === 'light') {
			document.documentElement.setAttribute('data-theme', theme);
			localStorage.setItem(this.THEME_KEY, theme);
			
			// Update button appearance
			const btn = document.getElementById('theme-toggle-btn');
			if (btn) {
				btn.textContent = theme === 'dark' ? '☀️' : '🌙';
				btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
			}

			// Notify server if user is authenticated
			this.syncWithServer(theme);
		}
	}

	getTheme() {
		return document.documentElement.getAttribute('data-theme') || 'light';
	}

	toggleTheme() {
		const current = this.getTheme();
		const next = current === 'dark' ? 'light' : 'dark';
		this.setTheme(next);
	}

	loadFromStorage() {
		try {
			return localStorage.getItem(this.THEME_KEY);
		} catch (e) {
			console.warn('Could not access localStorage:', e);
			return null;
		}
	}

	async loadFromDatabase() {
		// Only attempt to load from DB if user is logged in
		try {
			const response = await fetch('/api/auth/me');
			if (response.ok) {
				const user = await response.json();
				const dbTheme = user.theme_preference || this.getTheme();
				// Don't override if user has already set a local preference
				if (!localStorage.getItem(this.THEME_KEY)) {
					this.setTheme(dbTheme);
				}
			}
		} catch (e) {
			// User not logged in, that's fine
		}
	}

	async syncWithServer(theme) {
		// Only sync if user is authenticated
		try {
			// Check if user is authenticated first
			const authResponse = await fetch('/api/auth/me');
			if (authResponse.ok) {
				// Send theme preference to server
				await fetch('/api/user/theme', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ theme_preference: theme })
				}).catch(e => {
					// If endpoint doesn't exist yet, silently fail
					console.debug('Theme sync with server not yet implemented');
				});
			}
		} catch (e) {
			// Not logged in, that's okay
		}
	}

	createThemeToggle() {
		// The site uses one presentation theme; keep the theme control out of the menu.
		document.querySelectorAll('#theme-toggle-btn, .theme-toggle-nav, .theme-toggle-fixed').forEach((button) => button.remove());
	}
}

async function initializeStudentPresenceHeartbeat() {
	try {
		const response = await fetch('/api/auth/me', { credentials: 'include' });
		if (!response.ok) return;
		const payload = await response.json();
		if (String(payload && payload.user && payload.user.role || '').toLowerCase() !== 'student') return;
		const heartbeat = () => fetch('/api/presence/heartbeat', { method: 'POST', credentials: 'include', keepalive: true }).catch(() => {});
		heartbeat();
		window.setInterval(heartbeat, 25000);
		document.addEventListener('visibilitychange', () => { if (!document.hidden) heartbeat(); });
	} catch (_) {
		// Presence tracking must never interrupt the student's page.
	}
}

function injectStudentPresenceStyles() {
	if (document.getElementById('itrack-presence-styles')) return;
	const style = document.createElement('style');
	style.id = 'itrack-presence-styles';
	style.textContent = '.itrack-presence-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:999px;font:700 .7rem Manrope,Arial,sans-serif}.itrack-presence-badge.online{background:#d9f5e6;color:#087347;border:1px solid #9edebb}.itrack-presence-badge.offline{background:#edf2f4;color:#657982;border:1px solid #d5e0e3}.itrack-presence-dot{width:8px;height:8px;border-radius:50%;background:currentColor}.itrack-presence-time{display:block;margin-top:4px;color:#71817c;font-size:.62rem}.itrack-online-metric{background:#eaf9f1!important;border-color:#9edabb!important;color:#0c7448!important}.itrack-adviser-presence{margin:0 0 18px;padding:16px;border:1px solid #cfe3df;border-radius:16px;background:linear-gradient(145deg,#fff,#f1faf7);box-shadow:0 9px 24px rgba(16,47,73,.06)}.itrack-adviser-presence h2{margin:0 0 4px;font-size:1rem}.itrack-adviser-presence>p{margin:0 0 12px;color:#647a86;font-size:.76rem}.itrack-presence-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:9px}.itrack-presence-student{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 11px;border:1px solid #dbe8e5;border-radius:12px;background:#fff}.itrack-presence-student strong{display:block;font-size:.78rem}.itrack-presence-student small{color:#71817c;font-size:.65rem}@media(max-width:900px){.metrics:has(.itrack-online-metric){grid-template-columns:repeat(3,1fr)!important}}@media(max-width:460px){.metrics:has(.itrack-online-metric){grid-template-columns:1fr!important}}';
	document.head.appendChild(style);
}

function injectFinalGradeStyles() {
	if (document.getElementById('itrack-final-grade-styles')) return;
	const style = document.createElement('style');
	style.id = 'itrack-final-grade-styles';
	style.textContent = '.itrack-final-grade{width:100%;margin-top:12px;padding:12px;border:1px solid #d5e5e1;border-radius:12px;background:linear-gradient(145deg,#fff9e8,#f7fbfa)}.itrack-final-grade-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.itrack-final-grade-label{color:#5a6f77;font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.itrack-final-grade-value{color:#123047;font-size:1.25rem;font-weight:800}.itrack-grade-form{display:flex;align-items:center;gap:8px;margin-top:9px}.itrack-grade-form input{width:82px;min-height:36px;padding:7px 9px;border:1px solid #b9d2cd;border-radius:9px;background:#fff;color:#123047;font:700 .78rem Manrope,Arial,sans-serif}.itrack-grade-form button{min-height:36px;padding:7px 11px;border:0;border-radius:9px;background:#167a70;color:#fff;font:800 .7rem Manrope,Arial,sans-serif;cursor:pointer}.itrack-grade-form button:disabled{opacity:.6}.itrack-grade-note{display:block;margin-top:5px;color:#71817c;font-size:.62rem}.itrack-grade-pending{color:#8a6500;font-size:.72rem;font-weight:700}';
	document.head.appendChild(style);
}

function formatPresenceLastSeen(value) {
	if (!value) return 'Not seen recently';
	const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	return new Date(value).toLocaleString();
}

function escapePresenceText(value) {
	return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function presenceBadge(presence) {
	const online = Boolean(presence && presence.online);
	return `<span class="itrack-presence-badge ${online ? 'online' : 'offline'}"><span class="itrack-presence-dot"></span>${online ? 'Online now' : 'Offline'}</span><span class="itrack-presence-time">${formatPresenceLastSeen(presence && presence.last_seen_at)}</span>`;
}

function initializeAdministratorStudentPresence() {
	if (!/admin-students\.html$/i.test(location.pathname)) return;
	injectStudentPresenceStyles();
	const refresh = async () => {
		try {
			const response = await fetch('/api/admin/student-monitoring', { credentials: 'include' });
			if (!response.ok) return;
			const data = await response.json();
			const byLrn = new Map((data.records || []).map((record) => [String(record.lrn || ''), record]));
			const table = document.querySelector('.student-table');
			if (table && !table.querySelector('[data-presence-heading]')) {
				const heading = document.createElement('th');
				heading.dataset.presenceHeading = 'true';
				heading.textContent = 'Presence';
				table.querySelector('thead tr').children[0].insertAdjacentElement('afterend', heading);
			}
			document.querySelectorAll('#studentBody tr').forEach((row) => {
				const match = String(row.cells[0] && row.cells[0].textContent || '').match(/LRN:\s*([^\s]+)/i);
				const record = match && byLrn.get(match[1]);
				if (!record) return;
				let cell = row.querySelector('[data-presence-cell]');
				if (!cell) {
					cell = document.createElement('td');
					cell.dataset.presenceCell = 'true';
					row.cells[0].insertAdjacentElement('afterend', cell);
				}
				cell.innerHTML = presenceBadge(record.presence);
			});
		} catch (_) {}
	};
	window.setTimeout(refresh, 650);
	window.setInterval(refresh, 30000);
}

function initializeAdviserStudentPresence() {
	if (!/learning-resources\.html$/i.test(location.pathname)) return;
	injectStudentPresenceStyles();
	const refresh = async () => {
		try {
			const response = await fetch('/api/learning-resources', { credentials: 'include' });
			if (!response.ok) return;
			const data = await response.json();
			if (String(data.role || '').toLowerCase() !== 'teacher') return;
			const students = new Map();
			(data.resources || []).forEach((resource) => {
				const key = String(resource.learner_lrn || resource.learner_id || '');
				if (key && !students.has(key)) students.set(key, resource);
			});
			let panel = document.getElementById('itrack-adviser-presence');
			if (!panel) {
				panel = document.createElement('section');
				panel.id = 'itrack-adviser-presence';
				panel.className = 'itrack-adviser-presence';
				const teacherPanel = document.getElementById('teacherPanel');
				if (teacherPanel) teacherPanel.insertAdjacentElement('afterend', panel);
			}
			if (!panel) return;
			const rows = Array.from(students.values());
			panel.innerHTML = '<h2>Student Online Status</h2><p>Live presence for student accounts assigned to you as teacher/adviser.</p><div class="itrack-presence-list">' + (rows.length ? rows.map((resource) => `<div class="itrack-presence-student"><div><strong>${escapePresenceText(resource.learner_name || 'Student')}</strong><small>LRN: ${escapePresenceText(resource.learner_lrn || '—')}</small></div><div>${presenceBadge(resource.student_presence)}</div></div>`).join('') : '<div class="itrack-presence-student"><small>No assigned student account yet.</small></div>') + '</div>';
		} catch (_) {}
	};
	window.setTimeout(refresh, 650);
	window.setInterval(refresh, 30000);
}

function initializeLearningResourceFinalGrades() {
	if (!/learning-resources\.html$/i.test(location.pathname)) return;
	injectFinalGradeStyles();
	let role = '';
	const decorate = async () => {
		try {
			const response = await fetch('/api/learning-resources', { credentials: 'include' });
			if (!response.ok) return;
			const data = await response.json();
			role = String(data.role || '').toLowerCase();
			const active = document.querySelector('.term-tab.active');
			const term = Number(active && active.dataset.term || 1);
			const resources = (data.resources || []).filter((resource) => Number(resource.term || 1) === term);
			document.querySelectorAll('#resourceGrid .resource-card').forEach((card, index) => {
				const resource = resources[index];
				if (!resource || String(resource.status || '') !== 'done') return;
				const gradeKey = resource.final_grade == null ? 'pending' : String(resource.final_grade);
				const existingPanel = card.querySelector('.itrack-final-grade');
				if (existingPanel && existingPanel.dataset.gradeValue === gradeKey) return;
				existingPanel?.remove();
				const panel = document.createElement('div');
				panel.className = 'itrack-final-grade';
				panel.dataset.resourceGradeId = resource.id;
				panel.dataset.gradeValue = gradeKey;
				const hasGrade = resource.final_grade != null;
				if (role === 'teacher' || role === 'admin') {
					panel.innerHTML = `<div class="itrack-final-grade-head"><span class="itrack-final-grade-label">Score</span><strong class="itrack-final-grade-value">${hasGrade ? Number(resource.final_grade) : 'Pending'}</strong></div><form class="itrack-grade-form" data-final-grade-form="${escapePresenceText(resource.id)}"><input name="final_grade" type="number" step="any" value="${hasGrade ? Number(resource.final_grade) : ''}" placeholder="Enter score" aria-label="Score" required><button type="submit">${hasGrade ? 'Update' : 'Save Score'}</button></form><small class="itrack-grade-note">Available after the student submits the completed answer.</small>`;
				} else {
					panel.innerHTML = hasGrade ? `<div class="itrack-final-grade-head"><span class="itrack-final-grade-label">Score</span><strong class="itrack-final-grade-value">${Number(resource.final_grade)}</strong></div><small class="itrack-grade-note">Entered by your teacher/adviser${resource.graded_at ? ' · ' + formatPresenceLastSeen(resource.graded_at) : ''}</small>` : '<span class="itrack-grade-pending">Score pending teacher assessment</span>';
				}
				const actions = card.querySelector('.card-actions');
				if (actions) actions.insertAdjacentElement('beforebegin', panel); else card.appendChild(panel);
			});
		} catch (_) {}
	};
	document.addEventListener('submit', async (event) => {
		const form = event.target.closest('[data-final-grade-form]');
		if (!form) return;
		event.preventDefault();
		const button = form.querySelector('button');
		const grade = Number(new FormData(form).get('final_grade'));
		button.disabled = true;
		button.textContent = 'Saving…';
		try {
			const response = await fetch(`/api/learning-resources/${encodeURIComponent(form.dataset.finalGradeForm)}/final-grade`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ final_grade: grade }) });
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.message || 'Unable to save score.');
			const value = form.closest('.itrack-final-grade').querySelector('.itrack-final-grade-value');
			value.textContent = String(data.final_grade);
			button.textContent = 'Update';
		} catch (error) {
			window.alert(error.message);
			button.textContent = 'Save Score';
		} finally {
			button.disabled = false;
		}
	});
	window.setTimeout(decorate, 700);
	window.setInterval(decorate, 15000);
	document.querySelectorAll('.term-tab').forEach((button) => button.addEventListener('click', () => window.setTimeout(decorate, 80)));
}

function initializeStudentProfileFinalGrades() {
	if (!/student-profile\.html$/i.test(location.pathname)) return;
	injectFinalGradeStyles();
	window.setTimeout(async () => {
		try {
			const response = await fetch('/api/student/profile', { credentials: 'include' });
			if (!response.ok) return;
			const data = await response.json();
			const table = document.querySelector('#performance .module-table');
			if (!table) return;
			if (!table.querySelector('[data-final-grade-heading]')) {
				const heading = document.createElement('th');
				heading.dataset.finalGradeHeading = 'true';
				heading.textContent = 'Score';
				table.querySelector('thead tr').appendChild(heading);
			}
			const modules = data.modules || [];
			const applyGrades = (attempt = 0) => {
				const rows = document.querySelectorAll('#moduleBody tr');
				if (!rows.length && modules.length && attempt < 10) { window.setTimeout(() => applyGrades(attempt + 1), 300); return; }
				rows.forEach((row, index) => {
				let cell = row.querySelector('[data-final-grade-cell]');
				if (!cell) { cell = document.createElement('td'); cell.dataset.finalGradeCell = 'true'; row.appendChild(cell); }
				const grade = modules[index] && modules[index].final_grade;
				cell.innerHTML = grade == null ? '<span class="itrack-grade-pending">Pending</span>' : `<strong class="itrack-final-grade-value">${Number(grade)}</strong>`;
				});
			};
			applyGrades();
		} catch (_) {}
	}, 700);
}

function initializeAdmDeadlineWarnings() {
	if (/^(?:\/)?(?:index|signup|signout)\.html$/i.test(location.pathname.replace(/^\//, ''))) return;
	const injectStyles = () => {
		if (document.getElementById('itrack-adm-deadline-styles')) return;
		const style = document.createElement('style');
		style.id = 'itrack-adm-deadline-styles';
		style.textContent = '.itrack-adm-warning-stack{position:fixed;top:82px;right:22px;z-index:12500;width:min(430px,calc(100vw - 32px));display:grid;gap:10px}.itrack-adm-warning{position:relative;padding:16px 44px 16px 17px;border:1px solid #e9bd52;border-left:6px solid #e0a318;border-radius:15px;background:#fff8dd;color:#4f3a05;box-shadow:0 16px 38px rgba(34,49,58,.2);font-family:Manrope,Arial,sans-serif}.itrack-adm-warning h2{display:flex;align-items:center;gap:8px;margin:0 0 6px;color:#6c4a00;font-size:.95rem}.itrack-adm-warning p{margin:0;line-height:1.5;font-size:.78rem}.itrack-adm-warning-meta{display:block;margin-top:8px;color:#745b21;font-size:.68rem;font-weight:700}.itrack-adm-warning-close{position:absolute;top:8px;right:8px;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:rgba(116,83,0,.09);color:#654b0a;font-size:1.1rem;cursor:pointer}@media(max-width:650px){.itrack-adm-warning-stack{top:70px;right:16px;left:16px;width:auto}}';
		document.head.appendChild(style);
	};
	const formatDate = (value) => {
		const parts = String(value || '').split('-').map(Number);
		if (parts.length !== 3 || parts.some(Number.isNaN)) return String(value || 'the due date');
		return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
	};
	window.setTimeout(async () => {
		try {
			const response = await fetch('/api/adm-deadline-alerts', { credentials: 'include' });
			if (!response.ok) return;
			const data = await response.json();
			const role = String(data.role || '').toLowerCase();
			if (role !== 'student' && role !== 'teacher') return;
			const alerts = Array.isArray(data.alerts) ? data.alerts : [];
			if (!alerts.length) return;
			injectStyles();
			const stack = document.createElement('aside');
			stack.className = 'itrack-adm-warning-stack';
			stack.setAttribute('aria-label', 'ADM deadline warnings');
			alerts.slice(0, 3).forEach((alert) => {
				const card = document.createElement('section');
				card.className = 'itrack-adm-warning';
				card.setAttribute('role', 'alert');
				const deadline = formatDate(alert.duration_to);
				const timeText = Number(alert.days_remaining) === 0 ? 'ends today' : `ends in ${Number(alert.days_remaining)} day${Number(alert.days_remaining) === 1 ? '' : 's'}`;
				const message = role === 'student'
					? `Your ADM duration ${timeText}. Answer your assigned learning resources immediately before ${deadline}.`
					: `The approved ADM duration ${timeText}. Please remind your students to complete their assigned learning resources before ${deadline}.`;
				card.innerHTML = `<button class="itrack-adm-warning-close" type="button" aria-label="Dismiss warning">×</button><h2><span aria-hidden="true">⚠️</span> ADM Period Almost Done</h2><p>${escapePresenceText(message)}</p><span class="itrack-adm-warning-meta">Reason: ${escapePresenceText(alert.reason_for_adm || 'ADM request')} · To: ${escapePresenceText(deadline)}</span>`;
				card.querySelector('button').addEventListener('click', () => card.remove());
				stack.appendChild(card);
			});
			document.body.appendChild(stack);
		} catch (_) {
			// Deadline warnings must not interrupt access to the page.
		}
	}, 900);
}

// Initialize theme manager when DOM is ready
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		initializeITrackPageLoader();
		createDepEdFixedHeader();
		createITrackPageTitlebar();
		initializeSchoolYearFields();
		createITrackFooter();
		initializeRequiredFields();
		initializeAdministratorReportsNavigation();
		initializeCreateAccountPopover();
		initializeModularLearningTracker();
		initializeStudentModularTracker();
		initializeStudentPresenceHeartbeat();
		initializeAdministratorStudentPresence();
		initializeAdviserStudentPresence();
		initializeLearningResourceFinalGrades();
		initializeStudentProfileFinalGrades();
		initializeAdmDeadlineWarnings();
		window.themeManager = new ThemeManager();
		document.documentElement.classList.remove('itrack-dashboard-boot');
	});
} else {
	initializeITrackPageLoader();
	createDepEdFixedHeader();
	createITrackPageTitlebar();
	initializeSchoolYearFields();
	createITrackFooter();
	initializeRequiredFields();
	initializeAdministratorReportsNavigation();
	initializeCreateAccountPopover();
	initializeModularLearningTracker();
	initializeStudentModularTracker();
	initializeStudentPresenceHeartbeat();
	initializeAdministratorStudentPresence();
	initializeAdviserStudentPresence();
	initializeLearningResourceFinalGrades();
	initializeStudentProfileFinalGrades();
	initializeAdmDeadlineWarnings();
	window.themeManager = new ThemeManager();
	document.documentElement.classList.remove('itrack-dashboard-boot');
}

// Expose toggle function globally for inline onclick handlers if needed
window.toggleTheme = () => {
	if (window.themeManager) {
		window.themeManager.toggleTheme();
	}
};
