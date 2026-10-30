import { convertChildrenDeserialize, fontRules, getStyleValue, type MdRules } from "@platejs/markdown";

/**
 * Text with more than one style (a color and a background, say) is saved as
 * nested `<span style>` tags, one per style. Plate's span rule sets every style
 * it knows on the text inside a span, so an inner span wiped the styles of the
 * spans around it on reopen. This rule only sets the styles a span names and
 * keeps the rest from the spans around it.
 */

/** The text props Plate saves as a span style: `fontSize` → `font-size`. */
const STYLE_PROPS = Object.keys(fontRules)
  .filter((key) => key !== "span")
  .map((prop) => [prop, prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)] as const);

export const fontStyleRules: MdRules = {
  span: {
    mark: true,
    deserialize: (mdastNode, deco, options) => {
      const styles: Record<string, string> = {};
      for (const [prop, styleName] of STYLE_PROPS) {
        const value = getStyleValue(mdastNode as never, styleName);
        if (value) styles[prop] = value;
      }
      return convertChildrenDeserialize(mdastNode.children, { ...deco, ...styles }, options);
    },
  },
};
