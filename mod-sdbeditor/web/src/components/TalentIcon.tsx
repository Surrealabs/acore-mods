import React from 'react';

interface SpriteInfo {
  sheet: string; // class name e.g. "warrior"
  x: number;     // pixel x offset in sprite sheet
  y: number;     // pixel y offset in sprite sheet
}

interface TalentIconProps {
  sprite: SpriteInfo | null;
  size?: number;
  spriteIconSize?: number;
  spriteIconsPerRow?: number;
}

const TalentIcon: React.FC<TalentIconProps> = ({
  sprite,
  size = 36,
  spriteIconSize = 64,
  spriteIconsPerRow = 16,
}) => {
  if (!sprite) {
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
  }

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
};

export default React.memo(TalentIcon);
