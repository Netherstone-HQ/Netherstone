// KaTeX's stylesheet and fonts, embedded in HTML exports that show math.
import katexCss from "katex/dist/katex.min.css?raw";
import katexFont0 from "katex/dist/fonts/KaTeX_AMS-Regular.woff2?url";
import katexFont1 from "katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?url";
import katexFont2 from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?url";
import katexFont3 from "katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?url";
import katexFont4 from "katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?url";
import katexFont5 from "katex/dist/fonts/KaTeX_Main-Bold.woff2?url";
import katexFont6 from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?url";
import katexFont7 from "katex/dist/fonts/KaTeX_Main-Italic.woff2?url";
import katexFont8 from "katex/dist/fonts/KaTeX_Main-Regular.woff2?url";
import katexFont9 from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?url";
import katexFont10 from "katex/dist/fonts/KaTeX_Math-Italic.woff2?url";
import katexFont11 from "katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?url";
import katexFont12 from "katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?url";
import katexFont13 from "katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?url";
import katexFont14 from "katex/dist/fonts/KaTeX_Script-Regular.woff2?url";
import katexFont15 from "katex/dist/fonts/KaTeX_Size1-Regular.woff2?url";
import katexFont16 from "katex/dist/fonts/KaTeX_Size2-Regular.woff2?url";
import katexFont17 from "katex/dist/fonts/KaTeX_Size3-Regular.woff2?url";
import katexFont18 from "katex/dist/fonts/KaTeX_Size4-Regular.woff2?url";
import katexFont19 from "katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?url";

export { katexCss };

/** woff2 URLs by file name, as `katex.min.css` refers to them. */
export const KATEX_FONT_URLS: Record<string, string> = {
  "KaTeX_AMS-Regular.woff2": katexFont0,
  "KaTeX_Caligraphic-Bold.woff2": katexFont1,
  "KaTeX_Caligraphic-Regular.woff2": katexFont2,
  "KaTeX_Fraktur-Bold.woff2": katexFont3,
  "KaTeX_Fraktur-Regular.woff2": katexFont4,
  "KaTeX_Main-Bold.woff2": katexFont5,
  "KaTeX_Main-BoldItalic.woff2": katexFont6,
  "KaTeX_Main-Italic.woff2": katexFont7,
  "KaTeX_Main-Regular.woff2": katexFont8,
  "KaTeX_Math-BoldItalic.woff2": katexFont9,
  "KaTeX_Math-Italic.woff2": katexFont10,
  "KaTeX_SansSerif-Bold.woff2": katexFont11,
  "KaTeX_SansSerif-Italic.woff2": katexFont12,
  "KaTeX_SansSerif-Regular.woff2": katexFont13,
  "KaTeX_Script-Regular.woff2": katexFont14,
  "KaTeX_Size1-Regular.woff2": katexFont15,
  "KaTeX_Size2-Regular.woff2": katexFont16,
  "KaTeX_Size3-Regular.woff2": katexFont17,
  "KaTeX_Size4-Regular.woff2": katexFont18,
  "KaTeX_Typewriter-Regular.woff2": katexFont19,
};
