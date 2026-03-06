import GLib from 'gi://GLib';

export function debounce(func, wait) {
    let timeoutId = null;
    
    const wrapper = function(...args) {
        if (timeoutId) GLib.source_remove(timeoutId);
        
        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, wait, () => {
            timeoutId = null;
            try { func.apply(this, args); } catch (e) { }
            return GLib.SOURCE_REMOVE;
        });
    };
    
    wrapper.cancel = () => {
        if (timeoutId) { 
            GLib.source_remove(timeoutId); 
            timeoutId = null; 
        }
    };
    
    return wrapper;
}

export function hexToRgba(colorStr, alpha) {
    let r = 20, g = 20, b = 20;
    
    if (colorStr.startsWith('#')) {
        let hex = colorStr.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        
        r = parseInt(hex.substring(0, 2), 16) || 20;
        g = parseInt(hex.substring(2, 4), 16) || 20;
        b = parseInt(hex.substring(4, 6), 16) || 20;
        
    } else if (colorStr.startsWith('rgb')) {
        const parts = colorStr.match(/[\d.]+/g);
        if (parts && parts.length >= 3) {
            r = parseInt(parts[0]);
            g = parseInt(parts[1]);
            b = parseInt(parts[2]);
        }
    }
    
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}