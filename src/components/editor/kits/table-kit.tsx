import { createSlatePlugin } from 'platejs';
import { preventDeleteTableCell } from '@platejs/table';
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from '@platejs/table/react';

import {
  TableCellElement,
  TableCellHeaderElement,
  TableElement,
  TableRowElement,
} from '@/components/ui/table-node';

/**
 * Backspace at a cell's start and Delete at its end stop at the cell
 * instead of merging its text with the block or cell next to it. Plate
 * exports this check but no longer runs it. It guards the plain delete
 * that runs after Plate's own rules, so a heading or list at a cell's
 * start still resets first.
 */
export const TableCellEdgesPlugin = createSlatePlugin({
  key: 'tableCellEdges',
}).overrideEditor(({ editor, tf: { delete: deleteText } }) => ({
  transforms: {
    delete(options) {
      if (
        !options?.at &&
        preventDeleteTableCell(editor, {
          reverse: !options?.reverse,
          unit: options?.unit,
        })
      ) {
        return;
      }
      deleteText(options);
    },
  },
}));

export const TableKit = [
  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(TableRowElement),
  TableCellPlugin.withComponent(TableCellElement),
  TableCellHeaderPlugin.withComponent(TableCellHeaderElement),
  TableCellEdgesPlugin,
];
