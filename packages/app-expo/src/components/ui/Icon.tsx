/**
 * Simple SVG icons matching the lucide-react icons used in Tauri mobile app.
 * Built with react-native-svg for native performance.
 */
import Svg, { Path, Circle, Line, Rect, Polyline, Polygon } from "react-native-svg";

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const defaultProps: Required<IconProps> = {
  size: 24,
  color: "#8e8e93",
  strokeWidth: 2,
};

function icon(pathData: (p: Required<IconProps>) => React.ReactNode) {
  return function IconComponent(props: IconProps) {
    const p = { ...defaultProps, ...props };
    return (
      <Svg
        width={p.size}
        height={p.size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={p.color}
        strokeWidth={p.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {pathData(p)}
      </Svg>
    );
  };
}

// Tab bar icons
export const BookOpenIcon = icon(() => (
  <>
    <Path d="M12 7v14" />
    <Path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  </>
));

export const MessageSquareIcon = icon(() => (
  <>
    <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </>
));

export const BotIcon = icon(() => (
  <>
    <Rect x="4" y="7" width="16" height="12" rx="4" />
    <Path d="M12 3v4" />
    <Path d="M8 12h.01" />
    <Path d="M16 12h.01" />
    <Path d="M9 16c.8.6 1.8 1 3 1s2.2-.4 3-1" />
  </>
));

export const NotebookPenIcon = icon(() => (
  <>
    <Path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
    <Path d="M2 6h4" />
    <Path d="M2 10h4" />
    <Path d="M2 14h4" />
    <Path d="M2 18h4" />
    <Path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
  </>
));

export const UserIcon = icon(() => (
  <>
    <Circle cx="12" cy="8" r="5" />
    <Path d="M20 21a8 8 0 0 0-16 0" />
  </>
));

// Action icons
export const PlusIcon = icon(() => (
  <>
    <Path d="M5 12h14" />
    <Path d="M12 5v14" />
  </>
));

export const SearchIcon = icon(() => (
  <>
    <Circle cx="11" cy="11" r="8" />
    <Path d="m21 21-4.3-4.3" />
  </>
));

export const XIcon = icon(() => (
  <>
    <Path d="M18 6 6 18" />
    <Path d="m6 6 12 12" />
  </>
));

export const SortAscIcon = icon(() => (
  <>
    <Path d="m3 8 4-4 4 4" />
    <Path d="M7 4v16" />
    <Path d="M11 12h4" />
    <Path d="M11 16h7" />
    <Path d="M11 20h10" />
  </>
));

export const ChevronRightIcon = icon(() => <Path d="m9 18 6-6-6-6" />);

export const ChevronLeftIcon = icon(() => <Path d="m15 18-6-6 6-6" />);

export const FolderIcon = icon(() => (
  <>
    <Path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 4A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </>
));

export const FolderPlusIcon = icon(() => (
  <>
    <Path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 4A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    <Path d="M12 10v6" />
    <Path d="M9 13h6" />
  </>
));

export const FolderInputIcon = icon(() => (
  <>
    <Path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 4A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    <Path d="M12 10v6" />
    <Path d="m9 13 3 3 3-3" />
  </>
));

export const MoreVerticalIcon = icon(() => (
  <>
    <Circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
    <Circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <Circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
  </>
));

export const BrainIcon = icon(() => (
  <>
    <Path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <Path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <Path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    <Path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
    <Path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
    <Path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
    <Path d="M19.938 10.5a4 4 0 0 1 .585.396" />
    <Path d="M6 18a4 4 0 0 1-1.967-.516" />
    <Path d="M19.967 17.484A4 4 0 0 1 18 18" />
  </>
));

export const ScrollTextIcon = icon(() => (
  <>
    <Path d="M15 12h-5" />
    <Path d="M15 8h-5" />
    <Path d="M19 17V5a2 2 0 0 0-2-2H4" />
    <Path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2" />
  </>
));

export const LightbulbIcon = icon(() => (
  <>
    <Path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
    <Path d="M9 18h6" />
    <Path d="M10 22h4" />
  </>
));

export const HistoryIcon = icon(() => (
  <>
    <Path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <Path d="M3 3v5h5" />
    <Path d="M12 7v5l4 2" />
  </>
));

export const MessageCirclePlusIcon = icon(() => (
  <>
    <Path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    <Path d="M8 12h8" />
    <Path d="M12 8v8" />
  </>
));

// Profile/settings icons
export const PaletteIcon = icon(() => (
  <>
    <Circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
    <Circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
    <Circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
    <Circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <Path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
  </>
));

export const RefreshCwIcon = icon(() => (
  <>
    <Path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <Path d="M21 3v5h-5" />
    <Path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <Path d="M3 21v-5h5" />
  </>
));

export const CloudIcon = icon(() => (
  <Path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
));

export const DatabaseIcon = icon(() => (
  <>
    <Path d="M12 3c4.97 0 9 1.34 9 3s-4.03 3-9 3-9-1.34-9-3 4.03-3 9-3Z" />
    <Path d="M21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3" />
    <Path d="M3 6v12c0 1.66 4.03 3 9 3s9-1.34 9-3V6" />
  </>
));

export const Volume2Icon = icon(() => (
  <>
    <Path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
    <Path d="M16 9a5 5 0 0 1 0 6" />
    <Path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
  </>
));

export const HeadphonesIcon = icon(() => (
  <Path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
));

export const PlayIcon = icon((p) => (
  <Polygon points="6 3 20 12 6 21 6 3" fill={p.color} stroke={p.color} />
));

export const PauseIcon = icon((p) => (
  <>
    <Rect x="14" y="4" width="4" height="16" rx="1" fill={p.color} stroke={p.color} />
    <Rect x="6" y="4" width="4" height="16" rx="1" fill={p.color} stroke={p.color} />
  </>
));

export const SquareIcon = icon((p) => (
  <Rect x="3" y="3" width="18" height="18" rx="2" fill={p.color} stroke={p.color} />
));

export const RotateCcwIcon = icon(() => (
  <>
    <Path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <Path d="M3 3v5h5" />
  </>
));

export const SkipBackIcon = icon(() => (
  <>
    <Polygon points="19 20 9 12 19 4 19 20" fill="none" />
    <Line x1="5" y1="19" x2="5" y2="5" />
  </>
));

export const SkipForwardIcon = icon(() => (
  <>
    <Polygon points="5 4 15 12 5 20 5 4" fill="none" />
    <Line x1="19" y1="5" x2="19" y2="19" />
  </>
));

export const LanguagesIcon = icon(() => (
  <>
    <Path d="m5 8 6 6" />
    <Path d="m4 14 6-6 2-3" />
    <Path d="M2 5h12" />
    <Path d="M7 2h1" />
    <Path d="m22 22-5-10-5 10" />
    <Path d="M14 18h6" />
  </>
));

export const CpuIcon = icon(() => (
  <>
    <Rect x="4" y="4" width="16" height="16" rx="2" />
    <Rect x="9" y="9" width="6" height="6" rx="1" />
    <Path d="M15 2v2" />
    <Path d="M15 20v2" />
    <Path d="M2 15h2" />
    <Path d="M2 9h2" />
    <Path d="M20 15h2" />
    <Path d="M20 9h2" />
    <Path d="M9 2v2" />
    <Path d="M9 20v2" />
  </>
));

export const PuzzleIcon = icon(() => (
  <>
    <Path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.611a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.611-1.611a2.404 2.404 0 0 1 1.704-.706c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
  </>
));

export const HelpCircleIcon = icon(() => (
  <>
    <Circle cx="12" cy="12" r="10" />
    <Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <Path d="M12 17h.01" />
  </>
));

export const InfoIcon = icon(() => (
  <>
    <Circle cx="12" cy="12" r="10" />
    <Path d="M12 16v-4" />
    <Path d="M12 8h.01" />
  </>
));

export const BarChart3Icon = icon(() => (
  <>
    <Path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <Path d="M7 16h.01" />
    <Path d="M11 11h.01" />
    <Path d="M15 16h.01" />
    <Path d="M7 11v5" />
    <Path d="M11 6v10" />
    <Path d="M15 11v5" />
  </>
));

// Reading stats icons
export const ClockIcon = icon(() => (
  <>
    <Circle cx="12" cy="12" r="10" />
    <Polyline points="12 6 12 12 16 14" />
  </>
));

export const FlameIcon = icon(() => (
  <Path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
));

export const TrendingUpIcon = icon(() => (
  <>
    <Polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <Polyline points="16 7 22 7 22 13" />
  </>
));

export const TrophyIcon = icon(() => (
  <>
    <Path d="M8 21h8" />
    <Path d="M12 17v4" />
    <Path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <Path d="M5 6H4a2 2 0 0 0 0 4h1" />
    <Path d="M19 6h1a2 2 0 0 1 0 4h-1" />
  </>
));

export const SwordsIcon = icon(() => (
  <>
    <Path d="m14.5 5.5 4 4" />
    <Path d="m5.5 14.5 4 4" />
    <Path d="m4 20 6.5-6.5" />
    <Path d="m13.5 10.5 6.5-6.5" />
    <Path d="m8 4 12 12" />
    <Path d="m15.5 18.5 2.5 2.5" />
    <Path d="m3.5 6.5 2.5 2.5" />
  </>
));

export const HighlighterIcon = icon(() => (
  <>
    <Path d="m9 11-6 6v3h9l3-3" />
    <Path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
  </>
));

export const CopyIcon = icon(() => (
  <>
    <Rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <Path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </>
));

export const Trash2Icon = icon(() => (
  <>
    <Path d="M3 6h18" />
    <Path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <Path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    <Line x1="10" x2="10" y1="11" y2="17" />
    <Line x1="14" x2="14" y1="11" y2="17" />
  </>
));

export const TagIcon = icon(() => (
  <>
    <Path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
    <Circle cx="7.5" cy="7.5" r="1.5" />
  </>
));

export const CheckCheckIcon = icon(() => (
  <>
    <Path d="M18 6 7 17l-5-5" />
    <Path d="m22 10-7.5 7.5L13 16" />
  </>
));

export const SparklesIcon = icon(() => (
  <>
    <Path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <Path d="M5 3v4" />
    <Path d="M19 17v4" />
    <Path d="M3 5h4" />
    <Path d="M17 19h4" />
  </>
));

export const LoaderIcon = icon(() => (
  <Path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
));

export const Loader2Icon = icon(() => <Path d="M21 12a9 9 0 1 1-6.219-8.56" />);

export const WrenchIcon = icon(() => (
  <>
    <Path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </>
));

// Additional icons for features
export const HashIcon = icon(() => (
  <>
    <Line x1="4" x2="20" y1="9" y2="9" />
    <Line x1="4" x2="20" y1="15" y2="15" />
    <Line x1="10" x2="8" y1="3" y2="21" />
    <Line x1="16" x2="14" y1="3" y2="21" />
  </>
));

export const ArrowDownAZIcon = icon(() => (
  <>
    <Path d="m3 16 4 4 4-4" />
    <Path d="M7 20V4" />
    <Path d="M20 8h-5" />
    <Path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10" />
    <Path d="M15 14h5l-5 6h5" />
  </>
));

export const ArrowUpAZIcon = icon(() => (
  <>
    <Path d="m3 8 4-4 4 4" />
    <Path d="M7 4v16" />
    <Path d="M20 8h-5" />
    <Path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10" />
    <Path d="M15 14h5l-5 6h5" />
  </>
));

export const SendIcon = icon(() => (
  <>
    <Path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
    <Path d="m21.854 2.147-10.94 10.939" />
  </>
));

export const StopCircleIcon = icon(() => (
  <>
    <Circle cx="12" cy="12" r="10" />
    <Rect x="9" y="9" width="6" height="6" rx="1" />
  </>
));

export const OctagonXIcon = icon(() => (
  <>
    <Path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2z" />
    <Path d="m15 9-6 6" />
    <Path d="m9 9 6 6" />
  </>
));

export const ChevronDownIcon = icon(() => <Path d="m6 9 6 6 6-6" />);

export const ChevronUpIcon = icon(() => <Path d="m18 15-6-6-6 6" />);

export const CheckIcon = icon(() => <Path d="M20 6 9 17l-5-5" />);

export const EditIcon = icon(() => (
  <>
    <Path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
  </>
));

export const ShareIcon = icon(() => (
  <>
    <Path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <Polyline points="16 6 12 2 8 6" />
    <Line x1="12" x2="12" y1="2" y2="15" />
  </>
));

export const FilterIcon = icon(() => <Path d="M22 3H2l8 9.46V19l4 2v-8.54z" />);

export const CalendarIcon = icon(() => (
  <>
    <Path d="M8 2v4" />
    <Path d="M16 2v4" />
    <Rect width="18" height="18" x="3" y="4" rx="2" />
    <Path d="M3 10h18" />
  </>
));

export const SwitchIcon = icon(() => (
  <>
    <Path d="M17 1l4 4-4 4" />
    <Path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <Path d="m7 23-4-4 4-4" />
    <Path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </>
));

export const SunIcon = icon(() => (
  <>
    <Circle cx="12" cy="12" r="4" />
    <Path d="M12 2v2" />
    <Path d="M12 20v2" />
    <Path d="m4.93 4.93 1.41 1.41" />
    <Path d="m17.66 17.66 1.41 1.41" />
    <Path d="M2 12h2" />
    <Path d="M20 12h2" />
    <Path d="m6.34 17.66-1.41 1.41" />
    <Path d="m19.07 4.93-1.41 1.41" />
  </>
));

export const MoonIcon = icon(() => <Path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />);

export const Undo2Icon = icon(() => (
  <>
    <Path d="M9 14 4 9l5-5" />
    <Path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
  </>
));

export const Redo2Icon = icon(() => (
  <>
    <Path d="m15 14 5-5-5-5" />
    <Path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
  </>
));

export const EyeIcon = icon(() => (
  <>
    <Path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <Circle cx="12" cy="12" r="3" />
  </>
));

export const EyeOffIcon = icon(() => (
  <>
    <Path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
    <Path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
    <Path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
    <Path d="m2 2 20 20" />
  </>
));

export const BoldIcon = icon(() => <Path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />);

export const BoldIcon2 = icon(() => <Path d="M6 12h9a4 4 0 0 1 0 8H6z" />);

export const ItalicIcon = icon(() => (
  <>
    <Line x1="19" x2="10" y1="4" y2="4" />
    <Line x1="14" x2="5" y1="20" y2="20" />
    <Line x1="15" x2="9" y1="4" y2="20" />
  </>
));

export const StrikethroughIcon = icon(() => (
  <>
    <Path d="M16 4H9a3 3 0 0 0-2.83 4" />
    <Path d="M14 12a4 4 0 0 1 0 8H6" />
    <Line x1="4" x2="20" y1="12" y2="12" />
  </>
));

export const ListIcon = icon(() => (
  <>
    <Line x1="8" x2="21" y1="6" y2="6" />
    <Line x1="8" x2="21" y1="12" y2="12" />
    <Line x1="8" x2="21" y1="18" y2="18" />
    <Line x1="3" x2="3.01" y1="6" y2="6" />
    <Line x1="3" x2="3.01" y1="12" y2="12" />
    <Line x1="3" x2="3.01" y1="18" y2="18" />
  </>
));

export const ListOrderedIcon = icon(() => (
  <>
    <Line x1="10" x2="21" y1="6" y2="6" />
    <Line x1="10" x2="21" y1="12" y2="12" />
    <Line x1="10" x2="21" y1="18" y2="18" />
    <Path d="M4 6h1v4" />
    <Path d="M4 10h2" />
    <Path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
  </>
));

export const CodeIcon = icon(() => (
  <>
    <Polyline points="16 18 22 12 16 6" />
    <Polyline points="8 6 2 12 8 18" />
  </>
));

export const Link2Icon = icon(() => (
  <>
    <Path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <Path d="M15 7h2a5 5 0 1 1 0 10h-2" />
    <Line x1="8" x2="16" y1="12" y2="12" />
  </>
));

export const QuoteIcon = icon(() => (
  <>
    <Path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21c0 1 0 1 1 1z" />
    <Path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
  </>
));

export const MinusIcon = icon(() => <Path d="M5 12h14" />);

export const Heading1Icon = icon(() => (
  <>
    <Path d="M4 12h8" />
    <Path d="M4 18V6" />
    <Path d="M12 18V6" />
    <Path d="m17 12 3-2v8" />
  </>
));

export const Heading2Icon = icon(() => (
  <>
    <Path d="M4 12h8" />
    <Path d="M4 18V6" />
    <Path d="M12 18V6" />
    <Path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" />
  </>
));

export const Heading3Icon = icon(() => (
  <>
    <Path d="M4 12h8" />
    <Path d="M4 18V6" />
    <Path d="M12 18V6" />
    <Path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2" />
    <Path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2" />
  </>
));

export const LibraryIcon = icon(() => (
  <>
    <Path d="m16 6 4 14" />
    <Path d="M12 6v14" />
    <Path d="M8 8v12" />
    <Path d="M4 4v16" />
  </>
));

// Mindmap/Mermaid view icons
export const ZoomIn = icon(() => (
  <>
    <Circle cx="11" cy="11" r="8" />
    <Path d="m21 21-4.3-4.3" />
    <Path d="M11 8v6" />
    <Path d="M8 11h6" />
  </>
));

export const ZoomOut = icon(() => (
  <>
    <Circle cx="11" cy="11" r="8" />
    <Path d="m21 21-4.3-4.3" />
    <Path d="M8 11h6" />
  </>
));

export const Download = icon(() => (
  <>
    <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <Polyline points="7 10 12 15 17 10" />
    <Line x1="12" x2="12" y1="15" y2="3" />
  </>
));

export const RotateCcw = icon(() => (
  <>
    <Path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <Path d="M3 3v5h5" />
  </>
));

export const Maximize2 = icon(() => (
  <>
    <Polyline points="15 3 21 3 21 9" />
    <Polyline points="9 21 3 21 3 15" />
    <Line x1="21" x2="14" y1="3" y2="10" />
    <Line x1="3" x2="10" y1="21" y2="14" />
  </>
));

export const Minimize2 = icon(() => (
  <>
    <Polyline points="4 14 10 14 10 20" />
    <Polyline points="20 10 14 10 14 4" />
    <Line x1="14" x2="21" y1="10" y2="3" />
    <Line x1="3" x2="10" y1="21" y2="14" />
  </>
));

export const BookmarkIcon = icon(() => (
  <Path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
));

// Filled variant for bookmark (active state)
export function BookmarkFilledIcon({
  size = 24,
  color = "#8e8e93",
}: { size?: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </Svg>
  );
}

// Font management icons
export const TypeIcon = icon(() => (
  <>
    <Path d="M4 7V4h16v3" />
    <Path d="M9 20h6" />
    <Path d="M12 4v16" />
  </>
));

export const LinkIcon = icon(() => (
  <>
    <Path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <Path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </>
));

export const GlobeIcon = icon(() => (
  <>
    <Circle cx="12" cy="12" r="10" />
    <Path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <Path d="M2 12h20" />
  </>
));

export const LayersIcon = icon(() => (
  <>
    <Polygon points="12 2 2 7 12 12 22 7 12 2" />
    <Polyline points="2 17 12 22 22 17" />
    <Polyline points="2 12 12 17 22 12" />
  </>
));

export const FolderMinusIcon = icon(() => (
  <>
    <Path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    <Line x1="9" y1="13" x2="15" y2="13" />
  </>
));
