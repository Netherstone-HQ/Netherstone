'use client';

import {
  FontBackgroundColorPlugin,
  FontColorPlugin,
  FontFamilyPlugin,
  FontSizePlugin,
} from '@platejs/basic-styles/react';
import { KEYS } from 'platejs';
import type { PlatePluginConfig } from 'platejs/react';

const options = {
  inject: { targetPlugins: [KEYS.p] },
} satisfies PlatePluginConfig;

// Text copied from a web page carries that page's own text colour, font and
// size, which fight the app's theme and save as HTML in the Markdown file.
// Styles picked in Netherstone paste through Plate's own fragment, not HTML.
const ignorePastedHtml = {
  parsers: { html: { deserializer: { query: () => false } } },
} satisfies PlatePluginConfig;

export const FontKit = [
  FontColorPlugin.configure({
    inject: {
      ...options.inject,
      nodeProps: {
        defaultNodeValue: 'black',
      },
    },
    ...ignorePastedHtml,
  }),
  FontBackgroundColorPlugin.configure(options),
  FontSizePlugin.configure({ ...options, ...ignorePastedHtml }),
  FontFamilyPlugin.configure({ ...options, ...ignorePastedHtml }),
];
