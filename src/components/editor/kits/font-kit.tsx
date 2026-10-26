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

export const FontKit = [
  FontColorPlugin.configure({
    inject: {
      ...options.inject,
      nodeProps: {
        defaultNodeValue: 'black',
      },
    },
    // Text copied from a web page carries that page's own text colour, which
    // can be unreadable on the app's theme. Colours picked in Netherstone
    // paste through Plate's own fragment, not HTML.
    parsers: { html: { deserializer: { query: () => false } } },
  }),
  FontBackgroundColorPlugin.configure(options),
  FontSizePlugin.configure(options),
  FontFamilyPlugin.configure(options),
];
