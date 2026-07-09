// ---------------------------------------------------------------------------
// Available Fonts — SSOT for font selection across the application
// ---------------------------------------------------------------------------
//
// Used by: Inspector (font dropdown), Preview (canvas rendering),
//          ExportDialog (ASS subtitle generation), CaptionPresetPanel.
//
// When adding a font: add it here. The compiler will surface omissions
// at every read site that imports this array.

export const AVAILABLE_FONTS = [
  'Inter',
  'Montserrat',
  'Poppins',
  'Oswald',
  'Anton',
  'Bebas Neue',
  'Fredoka',
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
  'Impact',
  'Comic Sans MS',
] as const

export type AvailableFont = (typeof AVAILABLE_FONTS)[number]
