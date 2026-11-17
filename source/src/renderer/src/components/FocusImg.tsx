// An <img> cropped around the face in it (lib/faceFocus), for artist photos in wide boxes.
import { useRef } from 'react'
import { useFaceFocus } from '@/lib/faceFocus'

export function FocusImg({ src, at, className }: { src: string; at?: number; className?: string }): React.JSX.Element {
  const ref = useRef<HTMLImageElement>(null)
  useFaceFocus(ref, src, at)
  return <img ref={ref} decoding="async" src={src} alt="" className={className} />
}
