
const urlCache = new Map<string, Promise<string | null>>();

async function fetchAvatarUrl(username: string): Promise<string | null> {
    if (!username) return null;
    
    const profileUrl = `https://www.instagram.com/${username}/`;
    // We use a CORS proxy to bypass browser restrictions on fetching the HTML
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(profileUrl)}`;

    try {
        const response = await fetch(proxyUrl);

        if (!response.ok) {
            console.warn(`Could not fetch profile HTML for ${username}: ${response.status} ${response.statusText}`);
            return null;
        }

        const html = await response.text();
        
        // The most reliable way to get the profile picture is from the 'og:image' meta tag.
        const ogImageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);

        if (ogImageMatch && ogImageMatch[1]) {
            // The URL in the meta tag might have HTML entities (e.g., &amp;), so we decode them.
            const imageUrl = ogImageMatch[1].replace(/&amp;/g, '&');
            
            // We still proxy the final image URL to prevent CORS issues when rendering the <img> tag.
            return `https://corsproxy.io/?${encodeURIComponent(imageUrl)}`;
        } else {
            console.warn(`Could not find 'og:image' meta tag for ${username}. The user may be private or the page structure has changed.`);
            return null;
        }

    } catch (error) {
        console.error(`Error fetching or parsing profile HTML for ${username}:`, error);
        return null;
    }
}

export function getAvatarUrl(username: string): Promise<string | null> {
    if (!urlCache.has(username)) {
        urlCache.set(username, fetchAvatarUrl(username));
    }
    return urlCache.get(username)!;
}
