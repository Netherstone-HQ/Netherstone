'use client';

import * as React from 'react';

import type { TElement } from 'platejs';

import { LineHeightPlugin } from '@platejs/basic-styles/react';
import { DropdownMenuItemIndicator } from '@radix-ui/react-dropdown-menu';
import { CheckIcon, WrapText } from 'lucide-react';
import { useEditorRef } from 'platejs/react';

import { useSelectionBlockProp } from '@/components/ui/use-selection-block-prop';

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';

import { ToolbarButton, ToolbarDropdown } from './toolbar';

const getLineHeight = (node: TElement) => node.lineHeight as number | undefined;

export function LineHeightToolbarButton({
  submenu,
}: {
  submenu?: boolean;
}) {
  const editor = useEditorRef();
  const { defaultNodeValue, validNodeValues: values = [] } =
    editor.getInjectProps(LineHeightPlugin);

  const value = useSelectionBlockProp({
    defaultValue: defaultNodeValue,
    getProp: getLineHeight,
  });

  const [open, setOpen] = React.useState(false);

  return (
    <ToolbarDropdown
      open={open}
      onOpenChange={setOpen}
      button={
        <ToolbarButton pressed={open} tooltip="Line height" isDropdown>
          <WrapText />
        </ToolbarButton>
      }
      contentProps={{ align: 'start', className: 'min-w-0' }}
      submenu={
        submenu ? { icon: <WrapText />, label: 'Line height' } : undefined
      }
    >
      <DropdownMenuRadioGroup
        value={value}
        onValueChange={(newValue) => {
          editor
            .getTransforms(LineHeightPlugin)
            .lineHeight.setNodes(Number(newValue));
          editor.tf.focus();
        }}
      >
        {values.map((value) => (
          <DropdownMenuRadioItem
            key={value}
            className="min-w-[180px] pl-2 *:first:[span]:hidden"
            value={value}
          >
            <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center">
              <DropdownMenuItemIndicator>
                <CheckIcon />
              </DropdownMenuItemIndicator>
            </span>
            {value}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </ToolbarDropdown>
  );
}
