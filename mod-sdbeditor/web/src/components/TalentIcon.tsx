import React from 'react';

interface SpriteInfo {
  sheet: string; // class name e.g. "warrior"
  x: number;     // pixel x offset in sprite sheet
  y: number;     // pixel y offset in sprite sheet
}

interface TalentIconProps {
  // Direct icon path (e.g. "spell_holy_holybolt"), same value used by
  // Spell Editor / Talent Editor's `/thumbnails/${iconPath}.png` images.
  // This is the primary, always-populated source of truth.
  iconPath?: string | null;
  // Legacy per-class sprite-sheet coordinates. Only works if the sprite
  // sheet was generated from Talent.dbc, which no longer exists on this
  // server — kept as a fallback but iconPath should be preferred.
  sprite?: SpriteInfo | null;
  size?: number;
  spriteIconSize?: number;
  spriteIconsPerRow?: number;
}

const TalentIcon: React.FC<TalentIconProps> = ({
  iconPath,
  sprite,
  size = 36,
  spriteIconSize = 64,
  spriteIconsPerRow = 16,
}) => {
  // Prefer the direct thumbnail image — same source used by Spell Editor's
  // icon picker and Talent Editor, and always populated by the icon manifest.
  if (iconPath) {
    return (
      <img
        src={`/thumbnails/${iconPath}.png`}
        alt=""
        style={{ width: size, height: size, objectFit: 'cover' }}
        onError={(e) => {
          const img = e.target as HTMLImageElement;
          // Fall back to the classic WoW "unknown" icon instead of a broken
          // image / blank cell if this particular thumbnail 404s.
          if (!img.src.endsWith('/thumbnails/INV_Misc_QuestionMark.png')) {
            img.src = '/thumbnails/INV_Misc_QuestionMark.png';
          } else {
            img.style.visibility = 'hidden';
          }
        }}
      />
    );
  }

  if (sprite) {
    const scale = size / spriteIconSize;
    const sheetWidth = spriteIconsPerRow * spriteIconSize;

    return (
      <div
        style={{
          width: size,
          height: size,
          backgroundImage: `url(/sprites/${sprite.sheet}.png)`,
          backgroundPosition: `-${sprite.x * scale}px -${sprite.y * scale}px`,
          backgroundSize: `${sheetWidth * scale}px auto`,
          backgroundRepeat: 'no-repeat',
          imageRendering: 'pixelated',
        }}
      />
    );
  }

  return (
    <div style={{
      width: size,
      height: size,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      fontSize: size * 0.5,
      color: '#FFD700',
      fontWeight: 'bold',
    }}>
      ★
    </div>
  );
};

export default React.memo(TalentIcon);
