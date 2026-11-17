import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * Status variants own their colors for BOTH themes. Light mode uses a dark
 * shade (-800/-900) on a faint tint; dark mode uses a light shade (-300) on
 * the same tint. The icon inherits the text color (currentColor), so title,
 * description and icon always match.
 *
 * Don't pass text-/bg-/border- color classes at call sites; pick a variant.
 * Bright -400/-500 text shades are unreadable on the light background.
 */
const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-current [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        muted: "border-border bg-surface-2 text-muted-foreground",
        destructive:
          "border-red-600/30 bg-red-500/10 text-red-800 dark:border-red-400/30 dark:text-red-300",
        success:
          "border-green-600/30 bg-green-500/10 text-green-800 dark:border-green-400/30 dark:text-green-300",
        warning:
          "border-amber-600/40 bg-amber-500/10 text-amber-900 dark:border-amber-400/30 dark:text-amber-300",
        info:
          "border-blue-600/30 bg-blue-500/10 text-blue-800 dark:border-blue-400/30 dark:text-blue-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
