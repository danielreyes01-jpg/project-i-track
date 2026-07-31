// Theme System - Manage dark/light mode per user

function createDepEdFixedHeader() {
	const pathname = String(window.location.pathname || '/').toLowerCase();
	const isLoginPage = pathname === '/' || pathname.endsWith('/index.html');
	if (isLoginPage) {
		document.documentElement.classList.add('login-page-without-deped-header');
		return;
	}

	if (document.getElementById('deped-fixed-header')) {
		return;
	}

	const header = document.createElement('header');
	header.id = 'deped-fixed-header';
	header.className = 'deped-fixed-header';
	header.setAttribute('role', 'banner');

	const image = document.createElement('img');
	image.src = '/assets/deped-cebu-header.png';
	image.alt = 'Department of Education, Region VII - Central Visayas, Division of Cebu Province';
	image.className = 'deped-fixed-header-image';
	header.appendChild(image);

	const compactBar = document.createElement('div');
	compactBar.className = 'deped-compact-bar';
	compactBar.setAttribute('aria-hidden', 'true');

	const compactBrand = document.createElement('a');
	compactBrand.className = 'deped-compact-brand';
	compactBrand.href = '/index.html';
	compactBrand.setAttribute('aria-label', 'Project i-Track home');

	const compactLogo = document.createElement('img');
	compactLogo.src = '/assets/itrack-final.png';
	compactLogo.alt = 'Project i-Track';
	compactLogo.className = 'deped-compact-logo';
	compactBrand.appendChild(compactLogo);

	const menuDock = document.createElement('div');
	menuDock.className = 'deped-compact-menu-dock';
	menuDock.setAttribute('aria-label', 'Site navigation');

	compactBar.appendChild(compactBrand);
	compactBar.appendChild(menuDock);
	header.appendChild(compactBar);

	document.body.insertBefore(header, document.body.firstChild);
	document.documentElement.classList.add('has-deped-fixed-header');
	initializeSmartHeader(header, compactBar, menuDock);
}

function initializeSmartHeader(header, compactBar, menuDock) {
	const navMenu = document.querySelector('.nav-menu');
	const navPanel = navMenu ? navMenu.closest('.nav-panel') : null;
	let navPlaceholder = null;
	let previewExpanded = false;

	if (navMenu && navMenu.parentNode) {
		navPlaceholder = document.createElement('span');
		navPlaceholder.className = 'nav-menu-origin';
		navPlaceholder.hidden = true;
		navMenu.parentNode.insertBefore(navPlaceholder, navMenu);
	}

	function dockMenu() {
		if (!navMenu || navMenu.parentNode === menuDock) {
			return;
		}
		menuDock.appendChild(navMenu);
		compactBar.setAttribute('aria-hidden', 'false');
		if (navPanel) {
			navPanel.classList.add('nav-menu-is-docked');
		}
	}

	function restoreMenu() {
		if (!navMenu || !navPlaceholder || !navPlaceholder.parentNode) {
			return;
		}
		navPlaceholder.parentNode.insertBefore(navMenu, navPlaceholder.nextSibling);
		if (navPanel) {
			navPanel.classList.remove('nav-menu-is-docked');
		}
	}

	function updateHeader() {
		const shouldCollapse = window.scrollY > 110;
		const isCompact = shouldCollapse && !previewExpanded;
		document.documentElement.classList.toggle('header-collapsed', shouldCollapse);
		document.documentElement.classList.toggle('header-preview-expanded', shouldCollapse && previewExpanded);

		if (isCompact) {
			dockMenu();
		} else {
			restoreMenu();
			compactBar.setAttribute('aria-hidden', 'true');
		}
	}

	header.addEventListener('mouseenter', () => {
		if (window.scrollY > 110) {
			previewExpanded = true;
			updateHeader();
		}
	});

	header.addEventListener('mouseleave', () => {
		previewExpanded = false;
		updateHeader();
	});

	header.addEventListener('focusin', () => {
		if (window.scrollY > 110) {
			previewExpanded = true;
			updateHeader();
		}
	});

	header.addEventListener('focusout', (event) => {
		if (!header.contains(event.relatedTarget)) {
			previewExpanded = false;
			updateHeader();
		}
	});

	window.addEventListener('scroll', updateHeader, { passive: true });
	updateHeader();
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

		if (label && !label.querySelector('.required-marker')) {
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
		// Only create if not already present
		if (document.getElementById('theme-toggle-btn')) {
			return;
		}

		const button = document.createElement('button');
		button.id = 'theme-toggle-btn';
		button.className = 'theme-toggle-nav';
		button.type = 'button';
		
		const currentTheme = this.getTheme();
		button.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
		button.setAttribute('aria-label', currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
		
		button.addEventListener('click', () => this.toggleTheme());
		
		// Try to insert beside user greeting first
		const navGreeting = document.getElementById('navGreeting');
		if (navGreeting && navGreeting.parentNode) {
			navGreeting.parentNode.insertBefore(button, navGreeting.nextSibling);
		} else {
			// Fallback: append to body
			document.body.appendChild(button);
			// Add fixed positioning class as fallback
			button.classList.add('theme-toggle-fixed');
		}
	}
}

// Initialize theme manager when DOM is ready
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		createDepEdFixedHeader();
		initializeRequiredFields();
		window.themeManager = new ThemeManager();
	});
} else {
	createDepEdFixedHeader();
	initializeRequiredFields();
	window.themeManager = new ThemeManager();
}

// Expose toggle function globally for inline onclick handlers if needed
window.toggleTheme = () => {
	if (window.themeManager) {
		window.themeManager.toggleTheme();
	}
};
