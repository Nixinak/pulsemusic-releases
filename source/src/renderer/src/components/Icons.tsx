import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

const Svg = ({ size = 20, children, ...rest }: P): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
)

export const PlayIcon = (p: P) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <path d="M7.5 4.6c0-1 1.1-1.6 2-1.1l10.4 6.4c.8.5.8 1.7 0 2.2L9.5 18.5c-.9.5-2-.1-2-1.1Z" />
  </Svg>
)
export const PauseIcon = (p: P) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <rect x="5.5" y="4" width="4.6" height="16" rx="1.4" />
    <rect x="13.9" y="4" width="4.6" height="16" rx="1.4" />
  </Svg>
)
export const NextIcon = (p: P) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <path d="M3 6.3c0-.9 1-1.4 1.7-.9l7 5.7c.6.5.6 1.4 0 1.8l-7 5.7c-.7.5-1.7 0-1.7-.9Z" />
    <path d="M12 6.3c0-.9 1-1.4 1.7-.9l7 5.7c.6.5.6 1.4 0 1.8l-7 5.7c-.7.5-1.7 0-1.7-.9Z" />
  </Svg>
)
export const PrevIcon = (p: P) => (
  <Svg {...p} stroke="none" fill="currentColor" style={{ transform: 'scaleX(-1)', ...p.style }}>
    <path d="M3 6.3c0-.9 1-1.4 1.7-.9l7 5.7c.6.5.6 1.4 0 1.8l-7 5.7c-.7.5-1.7 0-1.7-.9Z" />
    <path d="M12 6.3c0-.9 1-1.4 1.7-.9l7 5.7c.6.5.6 1.4 0 1.8l-7 5.7c-.7.5-1.7 0-1.7-.9Z" />
  </Svg>
)
export const ShuffleIcon = (p: P) => (
  <Svg {...p}>
    <path d="M16 4h4v4M20 4l-6.5 6.5M4 20l6-6M16 20h4v-4M20 20l-5.5-5.5M4 4l5 5" />
  </Svg>
)
export const RepeatIcon = (p: P & { one?: boolean }) => {
  const { one, ...rest } = p
  return (
    <Svg {...rest}>
      <path d="M17 2.5 20.5 6 17 9.5" />
      <path d="M3.5 11.5V10a4 4 0 0 1 4-4h13" />
      <path d="M7 21.5 3.5 18 7 14.5" />
      <path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13" />
      {one && <path d="M11.3 10.4 12.6 9.6v5" strokeWidth={1.6} />}
    </Svg>
  )
}
export const HeartIcon = (p: P & { filled?: boolean }) => {
  const { filled, ...rest } = p
  return (
    <Svg {...rest} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 20.3s-7.8-4.6-8.9-9.9C2.4 7 4.6 4.2 7.7 4.2c1.9 0 3.3 1 4.3 2.5 1-1.5 2.4-2.5 4.3-2.5 3.1 0 5.3 2.8 4.6 6.2-1.1 5.3-8.9 9.9-8.9 9.9Z" />
    </Svg>
  )
}
export const QueueIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h11M4 11h11M4 16h7" />
    <path d="M17 13.5v6.2a2 2 0 1 1-2-2h2M17 13.5l3.5-1" />
  </Svg>
)
export const LyricsIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" />
    <path d="M8 10h8M8 13h5" />
  </Svg>
)
export const DevicesIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="12" height="9" rx="1.6" />
    <path d="M6.5 17h5M9 13.5V17" />
    <rect x="16.5" y="8" width="5" height="11.5" rx="1.3" />
  </Svg>
)
export const VolumeIcon = (p: P & { level?: number }) => {
  const { level = 1, ...rest } = p
  return (
    <Svg {...rest}>
      <path d="M4 9.5h3l4.5-4v13L7 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" fill="currentColor" stroke="none" />
      {level > 0 && <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />}
      {level > 0.5 && <path d="M17.8 7a7 7 0 0 1 0 10" />}
      {level === 0 && <path d="m15.5 9.5 5 5m0-5-5 5" />}
    </Svg>
  )
}
export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m15.5 15.5 5 5" />
  </Svg>
)
export const HomeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19Z" />
  </Svg>
)
export const LibraryIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 4v16M9.5 4v16" />
    <path d="m14 4.6 5.8 15" />
  </Svg>
)
export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const ChevronLeft = (p: P) => (
  <Svg {...p}>
    <path d="m14.5 5-7 7 7 7" />
  </Svg>
)
export const ChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m9.5 5 7 7-7 7" />
  </Svg>
)
export const ChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m5 9.5 7 7 7-7" />
  </Svg>
)
export const MoreIcon = (p: P) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <circle cx="5.5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="18.5" cy="12" r="1.8" />
  </Svg>
)
export const MiniIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <rect x="11.5" y="11.5" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
  </Svg>
)
export const ExpandIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5" />
  </Svg>
)
export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
)
export const SettingsIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
  </Svg>
)
export const NoteIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 18V5.5l11-2V16" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </Svg>
)
export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
)
export const ComputerIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="12" rx="1.8" />
    <path d="M8 20h8M12 16.5V20" />
  </Svg>
)
export const PhoneIcon = (p: P) => (
  <Svg {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.4" />
    <path d="M11 18.5h2" />
  </Svg>
)
export const SpeakerIcon = (p: P) => (
  <Svg {...p}>
    <rect x="5.5" y="2.5" width="13" height="19" rx="2.4" />
    <circle cx="12" cy="14.5" r="3.4" />
    <circle cx="12" cy="7" r="1" fill="currentColor" />
  </Svg>
)
export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
)
export const EditIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z" />
  </Svg>
)
export const TrashIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7" />
  </Svg>
)
export const CrossfadeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 17c4 0 5-10 9-10s5 10 9 10" />
    <path d="M3 7c4 0 5 10 9 10s5-10 9-10" opacity={0.55} />
  </Svg>
)
export const CoverIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="12" cy="12" r="3.2" />
  </Svg>
)

/** Six dots: drag handle for reorderable rows. */
export const GripIcon = (): React.JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <circle cx="5.5" cy="4" r="1.3" />
    <circle cx="10.5" cy="4" r="1.3" />
    <circle cx="5.5" cy="8" r="1.3" />
    <circle cx="10.5" cy="8" r="1.3" />
    <circle cx="5.5" cy="12" r="1.3" />
    <circle cx="10.5" cy="12" r="1.3" />
  </svg>
)

export const MoonIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </Svg>
)
export const SparkleIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5Z" />
    <path d="M18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z" />
  </Svg>
)
export const WandIcon = (p: P) => (
  <Svg {...p}>
    <path d="m4 20 10.5-10.5" />
    <path d="m13 8 3 3" />
    <path d="M17 3v3M15.5 4.5h3M20 8v2M19 9h2M9.5 3.5v2M8.5 4.5h2" />
  </Svg>
)
export const ShareIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 15V3.5" />
    <path d="m7.5 8 4.5-4.5L16.5 8" />
    <path d="M5 12.5v5.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5" />
  </Svg>
)
export const SortIcon = (p: P) => (
  <Svg {...p}>
    <path d="M7 4v16M3.5 16.5 7 20l3.5-3.5" />
    <path d="M14 6h7M14 11h5M14 16h3" />
  </Svg>
)
export const ImageIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="m4 17 4.5-4.5 3.5 3.5 3-3 5 5" />
  </Svg>
)
export const CopyIcon = (p: P) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
    <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
  </Svg>
)
export const DownloadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5V15" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </Svg>
)
export const ToolsIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
)
export const ChartIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
)
export const CommandIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 6.5A2.5 2.5 0 1 0 6.5 9H9V6.5ZM15 6.5A2.5 2.5 0 1 1 17.5 9H15V6.5ZM9 17.5A2.5 2.5 0 1 1 6.5 15H9v2.5ZM15 17.5a2.5 2.5 0 1 0 2.5-2.5H15v2.5Z" />
    <path d="M9 9h6v6H9z" />
  </Svg>
)

export const MicIcon = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </Svg>
)
export const ArrowUpRightIcon = (p: P) => (
  <Svg {...p}>
    <path d="M7 17 17 7M8.5 7H17v8.5" />
  </Svg>
)
export const GlobeIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5Z" />
  </Svg>
)
export const PinIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.4" />
  </Svg>
)
export const PartyIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 20 9.5 6.5l8 8L4 20Z" />
    <path d="M14 4.5c.6 1 .6 2 0 3M18.5 9.5c1-.6 2-.6 3 0M16 2.5v1M21.5 6h-1M20 12.5l.7.7" />
  </Svg>
)
export const UsersIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
    <path d="M15.5 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
  </Svg>
)
export const UserPlusIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="8" r="3.8" />
    <path d="M3 20c.8-3.8 3.6-5.8 7-5.8 1.5 0 2.9.4 4 1.1" />
    <path d="M18.5 14v6M15.5 17h6" />
  </Svg>
)
export const HeadphonesIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
    <rect x="3" y="14" width="5" height="7" rx="2" />
    <rect x="16" y="14" width="5" height="7" rx="2" />
  </Svg>
)
