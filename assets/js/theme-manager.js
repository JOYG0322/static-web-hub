(function() {
    const THEME_KEY = 'bvvd_theme';
    
    const ThemeManager = {
        getTheme() {
            return localStorage.getItem(THEME_KEY) || 'auto';
        },
        
        setTheme(theme) {
            localStorage.setItem(THEME_KEY, theme);
            this.applyTheme(theme);
            this._dispatchThemeChange(theme);
        },
        
        applyTheme(theme) {
            if (theme === 'auto') {
                this.applySystemTheme();
            } else {
                this._applyThemeToDOM(theme);
            }
        },
        
        applySystemTheme() {
            const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            this._applyThemeToDOM(isDark ? 'dark' : 'light');
        },
        
        _applyThemeToDOM(theme) {
            if (theme === 'light') {
                document.documentElement.setAttribute('data-theme', 'light');
            } else {
                document.documentElement.removeAttribute('data-theme');
            }
        },
        
        _dispatchThemeChange(theme) {
            window.dispatchEvent(new CustomEvent('themechange', { 
                detail: { theme: theme } 
            }));
        },
        
        getCurrentAppliedTheme() {
            return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        },
        
        init() {
            const theme = this.getTheme();
            this.applyTheme(theme);
            
            if (window.matchMedia) {
                window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                    if (this.getTheme() === 'auto') {
                        this.applySystemTheme();
                        this._dispatchThemeChange('auto');
                    }
                });
            }
            
            window.addEventListener('storage', (e) => {
                if (e.key === THEME_KEY && e.newValue) {
                    this.applyTheme(e.newValue);
                    this._dispatchThemeChange(e.newValue);
                }
            });
            
            setTimeout(() => this._dispatchThemeChange(theme), 0);
        }
    };
    
    window.ThemeManager = ThemeManager;
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ThemeManager.init());
    } else {
        ThemeManager.init();
    }
})();
