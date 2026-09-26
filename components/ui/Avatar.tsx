import React, { useState, useEffect, useMemo } from 'react';
import { generateInitials } from '../../utils/imageUtils';
import { getAvatarUrl } from '../../utils/avatarUtils';

interface AvatarProps {
  userId: string;
  username: string;
}

export const Avatar: React.FC<AvatarProps> = ({ userId, username }) => {
    const [imageUrl, setImageUrl] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        // Reset image url when username changes to prevent showing stale avatar
        setImageUrl(null); 
        getAvatarUrl(username).then(url => {
            if (isMounted && url) {
                setImageUrl(url);
            }
        });
        return () => { isMounted = false; };
    }, [username]);

    const initials = useMemo(() => generateInitials(username), [username]);
    const colorSeed = useMemo(() => {
        // FIX: The `char` variable was being inferred as `unknown`. Using `split('')` ensures it is correctly typed as `string`.
        return userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    }, [userId]);

    const COLORS = ['bg-blue-200', 'bg-green-200', 'bg-yellow-200', 'bg-purple-200', 'bg-pink-200', 'bg-indigo-200'];
    const color = COLORS[colorSeed % COLORS.length];

    return (
        <a href={`https://www.instagram.com/${username}/`} target="_blank" rel="noopener noreferrer" title={`View ${username} on Instagram`} className="relative w-8 h-8 rounded-full flex-shrink-0">
            {imageUrl ? (
                <img src={imageUrl} alt={`${username} avatar`} className="w-full h-full rounded-full object-cover" loading="lazy" crossOrigin="anonymous" />
            ) : (
                <div className={`w-full h-full rounded-full flex items-center justify-center ${color} text-gray-700 font-bold text-xs`}>
                    {initials}
                </div>
            )}
        </a>
    );
};
