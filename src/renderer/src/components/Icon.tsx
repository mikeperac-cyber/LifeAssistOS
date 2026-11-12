import type { SVGProps } from 'react'

type IconName = 'checklist' | 'tasks' | 'settings' | 'sparkles' | 'teacher' | 'assistant' | 'send' | 'stop' | 'menu' | 'plus' | 'search' | 'inbox' | 'close' | 'projects' | 'briefcase' | 'home' | 'book' | 'leaf' | 'list' | 'board' | 'chevron' | 'clock' | 'flag' | 'review' | 'calendar' | 'documents' | 'alert' | 'pause' | 'check' | 'arrow' | 'filter' | 'target'

const paths: Record<IconName, React.ReactNode> = {
  checklist: <><path d="M8 5h12"/><path d="M8 12h12"/><path d="M8 19h12"/><path d="m3 5 1 1 2-2"/><path d="m3 12 1 1 2-2"/><path d="m3 19 1 1 2-2"/></>,
  tasks: <><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="m8 12 2.5 2.5L16.5 9"/></>,
  settings: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1 1.1.8-1.4 2.5-1.3-.6a7.7 7.7 0 0 1-1.8 1l-.2 1.4h-2.9l-.2-1.4a7.7 7.7 0 0 1-1.8-1l-1.3.6-1.4-2.5 1.1-.8a7.2 7.2 0 0 1 0-2.1l-1.1-.8 1.4-2.5 1.3.6a7.7 7.7 0 0 1 1.8-1l.2-1.4h2.9l.2 1.4a7.7 7.7 0 0 1 1.8 1l1.3-.6 1.4 2.5-1.1.8a7.2 7.2 0 0 1-.1 2Z" transform="translate(-1 -1) scale(1.08)"/></>,
  sparkles: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/><path d="m5 2 .6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6L5 2Z"/></>,
  teacher: <><path d="m3 6 9-3 9 3-9 3-9-3Z"/><path d="M6 8v5c0 1.8 2.7 3.5 6 3.5s6-1.7 6-3.5V8"/><path d="M21 6v7"/></>,
  assistant: <><path d="M8 10h8M8 14h5"/><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-3.4-.7L4 20l1.2-3.6A7.3 7.3 0 0 1 4 12c0-4.1 3.6-7.5 8-7.5s8 3.1 8 7Z"/></>,
  send: <><path d="m21 3-7.2 18-3.5-7.3L3 10.2 21 3Z"/><path d="M10.3 13.7 15 9"/></>,
  stop: <><rect x="7" y="7" width="10" height="10" rx="2"/></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></>,
  inbox: <><path d="M4 5h16l2 9v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5l2-9Z"/><path d="M2 14h5l2 3h6l2-3h5"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  projects: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/></>,
  home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z"/><path d="M4 17a2.5 2.5 0 0 1 2.5-2.5H20M8 7h7"/></>,
  leaf: <><path d="M20 4C11 4 5 7 5 14a6 6 0 0 0 6 6c7 0 9-7 9-16Z"/><path d="M4 22c3-6 7-9 13-13"/></>,
  list: <><path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></>,
  board: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></>,
  chevron: <><path d="m9 18 6-6-6-6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  flag: <><path d="M5 21V4m0 0c5-4 9 4 15 0v11c-6 4-10-4-15 0"/></>,
  review: <><path d="M8 4h11v16H5V7h3"/><path d="M8 2v5H3M9 11h6M9 15h4"/><path d="m3 12 1.5 1.5L7 11"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></>,
  documents: <><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
  alert: <><path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
  pause: <><circle cx="12" cy="12" r="9"/><path d="M9 8v8M15 8v8"/></>,
  check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
  filter: <><path d="M4 7h16M7 12h10m-7 5h4"/><circle cx="8" cy="7" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="17" r="1.5" fill="currentColor"/></>,
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></>
}

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{paths[name]}</svg>
}
