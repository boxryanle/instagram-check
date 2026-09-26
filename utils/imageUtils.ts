
export const generateInitials = (username: string): string => {
    if (!username) return '?';
    
    // Split by non-alphanumeric characters and remove empty parts to avoid undefined array access
    const parts = username.split(/[^a-zA-Z0-9]+/).filter(Boolean);
    
    if (parts.length >= 2) {
        // We have at least two valid alphanumeric parts
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    
    if (parts.length === 1) {
        // Only one part, take the first two characters
        return parts[0].slice(0, 2).toUpperCase();
    }

    // Fallback for cases with no alphanumeric characters (e.g. "_._")
    return (username.slice(0, 2) || '?').toUpperCase();
};
