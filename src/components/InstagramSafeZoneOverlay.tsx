import type { FC } from 'react';
import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Music, X } from 'lucide-react';
import type { InstagramPreset } from '../engine/pipeline';

interface SafeZoneProps {
  preset: InstagramPreset;
  active: boolean;
}

export const InstagramSafeZoneOverlay: FC<SafeZoneProps> = ({ preset, active }) => {
  if (!active) return null;

  const isStory = preset === 'stories';

  return (
    <div className="absolute inset-0 pointer-events-none z-10 select-none overflow-hidden flex flex-col justify-between">
      {isStory ? (
        // 9:16 Story / Reels Safe Zones
        <>
          {/* Top Story Safe Zone */}
          <div className="bg-gradient-to-b from-black/80 via-black/40 to-transparent pt-3 px-3 pb-6 flex flex-col gap-2">
            {/* Story progress dashes */}
            <div className="flex gap-1 w-full">
              <div className="h-0.5 bg-white/90 rounded-full flex-1" />
              <div className="h-0.5 bg-white/40 rounded-full flex-1" />
              <div className="h-0.5 bg-white/40 rounded-full flex-1" />
            </div>

            {/* User row */}
            <div className="flex items-center justify-between mt-1 text-white text-xs">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-600 p-[1.5px]">
                  <div className="w-full h-full bg-neutral-900 rounded-full flex items-center justify-center text-[10px] font-bold">
                    IG
                  </div>
                </div>
                <div className="flex flex-col">
                  <span className="font-semibold text-xs tracking-tight">your_handle</span>
                  <span className="text-[10px] text-white/70">14m • Reels / Story</span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-white/80">
                <MoreHorizontal className="w-4 h-4" />
                <X className="w-4 h-4" />
              </div>
            </div>

            {/* Safe zone boundary notice */}
            <div className="mt-1 border-b border-dashed border-cyan-400/60 pb-0.5 flex justify-between items-center text-[9px] font-mono text-cyan-300">
              <span>▲ TOP SAFE ZONE BOUNDARY (AVOID TEXT / FACES)</span>
              <span>150px</span>
            </div>
          </div>

          {/* Right Floating Reels Action Icons */}
          <div className="absolute right-3 bottom-20 flex flex-col items-center gap-4 text-white drop-shadow-md">
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-black/30 backdrop-blur-xs flex items-center justify-center">
                <Heart className="w-4 h-4 fill-white" />
              </div>
              <span className="text-[10px] font-mono mt-0.5">84.2K</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-black/30 backdrop-blur-xs flex items-center justify-center">
                <MessageCircle className="w-4 h-4 fill-white" />
              </div>
              <span className="text-[10px] font-mono mt-0.5">1,204</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-black/30 backdrop-blur-xs flex items-center justify-center">
                <Send className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono mt-0.5">Share</span>
            </div>
            <div className="w-7 h-7 rounded-full bg-neutral-800 border-2 border-white flex items-center justify-center animate-spin">
              <Music className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* Bottom Story Safe Zone */}
          <div className="bg-gradient-to-t from-black/85 via-black/50 to-transparent p-3 pt-6 flex flex-col gap-2">
            <div className="border-t border-dashed border-cyan-400/60 pt-0.5 flex justify-between items-center text-[9px] font-mono text-cyan-300">
              <span>▼ BOTTOM SAFE ZONE BOUNDARY</span>
              <span>220px</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 bg-white/20 backdrop-blur-md rounded-full px-4 py-2 text-white/70 text-xs border border-white/20">
                Send message...
              </div>
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white">
                <Heart className="w-4 h-4" />
              </div>
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white">
                <Send className="w-4 h-4" />
              </div>
            </div>
          </div>
        </>
      ) : (
        // 4:5 Feed Portrait & 1:1 Feed Square Safe Zones
        <>
          {/* Feed Header */}
          <div className="bg-gradient-to-b from-black/80 via-black/40 to-transparent p-3 pb-5 flex items-center justify-between text-white text-xs">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-600 p-[1.5px]">
                <div className="w-full h-full bg-neutral-900 rounded-full flex items-center justify-center text-[10px] font-bold">
                  IG
                </div>
              </div>
              <div>
                <span className="font-semibold block text-xs">your_brand</span>
                <span className="text-[10px] text-white/70 block">Original Audio</span>
              </div>
            </div>
            <MoreHorizontal className="w-4 h-4 text-white/90" />
          </div>

          {/* Feed Bottom Action Bar */}
          <div className="bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-5 text-white flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Heart className="w-5 h-5 text-white" />
                <MessageCircle className="w-5 h-5 text-white" />
                <Send className="w-5 h-5 text-white" />
              </div>
              <Bookmark className="w-5 h-5 text-white" />
            </div>

            <div className="text-[11px] text-white/90 line-clamp-1 mt-0.5">
              <span className="font-semibold mr-1.5">your_brand</span>
              Optimized with Lanczos-3 to 1080px resolution for ultra-sharp engagement.
            </div>

            <div className="border-t border-dashed border-rose-400/50 pt-0.5 flex justify-between items-center text-[9px] font-mono text-rose-300">
              <span>SAFE CANVAS: 1080px WIDTH CLAMPED</span>
              <span>{preset === 'portrait' ? '4:5 (1350h)' : '1:1 (1080h)'}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
