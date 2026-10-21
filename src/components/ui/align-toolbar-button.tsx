'use client';

import * as React from 'react';

import type { Alignment } from '@platejs/basic-styles';
import type { TElement } from 'platejs';

import { TextAlignPlugin } from '@platejs/basic-styles/react';
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
} from 'lucide-react';
import { useEditorPlugin } from 'platejs/react';

import { useSelectionBlockProp } from '@/components/ui/use-selection-block-prop';

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';

import { ToolbarButton, ToolbarDropdown } from './toolbar';

const items = [
  {
    icon: AlignLeftIcon,
    value: 'left',
  },
  {
    icon: AlignCenterIcon,
    value: 'center',
  },
  {
    icon: AlignRightIcon,
    value: 'right',
  },
  {
    icon: AlignJustifyIcon,
    value: 'justify',
  },
];

const getAlign = (node: TElement) => node.align as string | undefined;

export function AlignToolbarButton({ submenu }: { submenu?: boolean }) {
  const { editor, tf } = useEditorPlugin(TextAlignPlugin);
  const value =
    useSelectionBlockProp({
      defaultValue: 'start',
      getProp: getAlign,
    }) ?? 'left';

  const [open, setOpen] = React.useState(false);
  const IconValue =
    items.find((item) => item.value === value)?.icon ?? AlignLeftIcon;

  return (
    <ToolbarDropdown
      open={open}
      onOpenChange={setOpen}
      button={
        <ToolbarButton pressed={open} tooltip="Align" isDropdown>
          <IconValue />
        </ToolbarButton>
      }
      contentProps={{ align: 'start', className: 'min-w-0' }}
      submenu={submenu ? { icon: <IconValue />, label: 'Align' } : undefined}
    >
      <DropdownMenuRadioGroup
        value={value}
        onValueChange={(value) => {
          tf.textAlign.setNodes(value as Alignment);
          editor.tf.focus();
        }}
      >
        {items.map(({ icon: Icon, value: itemValue }) => (
          <DropdownMenuRadioItem
            key={itemValue}
            className="pl-2 data-[state=checked]:bg-accent *:first:[span]:hidden"
            value={itemValue}
          >
            <Icon />
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </ToolbarDropdown>
  );
}
