import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'

interface AccessibleDialogProps {
  labelledBy: string
  describedBy?: string
  className: string
  initialFocusRef?: RefObject<HTMLElement | null>
  onCancel?: () => void
  children: ReactNode
}

export function AccessibleDialog({
  labelledBy,
  describedBy,
  className,
  initialFocusRef,
  onCancel,
  children
}: AccessibleDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    dialog.showModal()
    const initialTarget = initialFocusRef?.current ?? dialog.querySelector<HTMLElement>(
      '[autofocus], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]'
    )
    ;(initialTarget ?? dialog).focus({ preventScroll: true })

    return () => {
      if (dialog.open) dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={className}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault()
        onCancel?.()
      }}
    >
      {children}
    </dialog>
  )
}
