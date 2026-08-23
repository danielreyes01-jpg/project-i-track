// Theme System - Manage dark/light mode per user

const ITRACK_BRAND_LOGO = 'assets/project-itrack-logo.png';
const ITRACK_SITE_ICON = 'assets/project-itrack-icon.png';

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
		['User Management', 'user.html'], ['Sign Out', 'signout.html']
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
	titlebar.innerHTML = '<span class="itrack-page-titlebar-marker" aria-hidden="true"></span><strong></strong><button class="itrack-header-signout" type="button">Sign Out <span aria-hidden="true">↪</span></button>';
	titlebar.querySelector('strong').textContent = title;
	titlebar.querySelector('.itrack-header-signout').addEventListener('click', () => {
		window.location.href = 'signout.html';
	});
	document.body.appendChild(titlebar);
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

function simplifyNavigation(navMenu) {
	const currentPage = String(window.location.pathname || '').split('/').pop().toLowerCase() || 'dashboard.html';
	const iconByLabel = [
		[/learner/i, '📋'], [/dashboard/i, '📊'], [/account/i, '👤'], [/(adm|flp) request/i, '📄'],
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
			['Student Dashboard', 'admin-students.html'], ['Student Profile', 'student-profile.html'], ['Learning Resources', 'learning-resources.html'], ['User Management', 'user.html']
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
		const administratorOrder = ['Learner Record', 'Dashboard', 'FLP Request Form', 'ADM Approval', 'Student Dashboard', 'Student Profile', 'Learning Resources', 'User Management'];
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
	if (accountGreeting && !String(accountGreeting.textContent || '').trim()) {
		fetch('/api/auth/me', { credentials: 'include' }).then((response) => response.ok ? response.json() : null).then((payload) => {
			const role = String((payload && payload.user && payload.user.role) || '').trim().toLowerCase();
			if (role === 'admin' && !navMenu.dataset.adminNavigationLoaded) {
				navMenu.dataset.adminNavigationLoaded = 'true';
				const adminItems = [
					['Learner Record', 'learner.html'], ['Dashboard', 'dashboard.html'], ['FLP Request Form', 'adm-request.html'], ['ADM Approval', 'approval-request.html'],
					['Student Dashboard', 'admin-students.html'], ['Student Profile', 'student-profile.html'], ['Learning Resources', 'learning-resources.html'], ['User Management', 'user.html']
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
		}).catch(() => {});
	}

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
	window.addEventListener('message', (event) => { if (event.data === 'itrack-account-created') closeOverlay(); });
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

// Initialize theme manager when DOM is ready
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		initializeITrackPageLoader();
		createDepEdFixedHeader();
		createITrackPageTitlebar();
		createITrackFooter();
		initializeRequiredFields();
		initializeCreateAccountPopover();
		window.themeManager = new ThemeManager();
		document.documentElement.classList.remove('itrack-dashboard-boot');
	});
} else {
	initializeITrackPageLoader();
	createDepEdFixedHeader();
	createITrackPageTitlebar();
	createITrackFooter();
	initializeRequiredFields();
	initializeCreateAccountPopover();
	window.themeManager = new ThemeManager();
	document.documentElement.classList.remove('itrack-dashboard-boot');
}

// Expose toggle function globally for inline onclick handlers if needed
window.toggleTheme = () => {
	if (window.themeManager) {
		window.themeManager.toggleTheme();
	}
};
