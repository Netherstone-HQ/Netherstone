'use client';

import {
  BLOCK_CONTEXT_MENU_ID,
  BlockMenuPlugin,
  BlockSelectionPlugin,
} from '@platejs/selection/react';
import {
  useEditorPlugin,
  useEditorReadOnly,
  usePluginOption,
} from 'platejs/react';
import * as React from 'react';

import { getTurnIntoBlocks, setBlockType } from '@/components/transforms';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { turnIntoItems } from '@/components/ui/turn-into-toolbar-button';

export function BlockContextMenu({ children }: { children: React.ReactNode }) {
  const { api, editor } = useEditorPlugin(BlockMenuPlugin);
  const readOnly = useEditorReadOnly();
  const openId = usePluginOption(BlockMenuPlugin, 'openId');
  const isOpen = openId === BLOCK_CONTEXT_MENU_ID;

  // Read when the menu opens; the selected blocks don't change while it's open.
  const turnIntoBlocks = isOpen
    ? getTurnIntoBlocks(
        editor,
        editor.getApi(BlockSelectionPlugin).blockSelection.getNodes()
      )
    : [];

  const handleTurnInto = (type: string) => {
    setBlockType(editor, type, { entries: turnIntoBlocks });
  };

  const handleAlign = React.useCallback(
    (align: 'center' | 'left' | 'right') => {
      editor
        .getTransforms(BlockSelectionPlugin)
        .blockSelection.setNodes({ align });
    },
    [editor]
  );

  return (
    <ContextMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          api.blockMenu.hide();
        }
      }}
    >
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) => {
          const dataset = (event.target as HTMLElement).dataset;
          const disabled =
            dataset?.slateEditor === 'true' ||
            readOnly ||
            dataset?.plateOpenContextMenu === 'false';

          if (disabled) return event.preventDefault();

          setTimeout(() => {
            api.blockMenu.show(BLOCK_CONTEXT_MENU_ID, {
              x: event.clientX,
              y: event.clientY,
            });
          }, 0);
        }}
      >
        <div className="w-full">{children}</div>
      </ContextMenuTrigger>
      {isOpen && (
        <ContextMenuContent
          className="w-64"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            editor.getApi(BlockSelectionPlugin).blockSelection.focus();
          }}
        >
          <ContextMenuGroup>
            <ContextMenuItem
              onClick={() => {
                editor
                  .getTransforms(BlockSelectionPlugin)
                  .blockSelection.removeNodes();
                editor.tf.focus();
              }}
            >
              Delete
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                editor
                  .getTransforms(BlockSelectionPlugin)
                  .blockSelection.duplicate();
              }}
            >
              Duplicate
            </ContextMenuItem>
            {turnIntoBlocks.length > 0 && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>Turn into</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-48">
                  {turnIntoItems.map(({ icon, label, value }) => (
                    <ContextMenuItem
                      key={value}
                      onClick={() => handleTurnInto(value)}
                    >
                      {icon}
                      {label}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
          </ContextMenuGroup>

          <ContextMenuGroup>
            <ContextMenuItem
              onClick={() =>
                editor
                  .getTransforms(BlockSelectionPlugin)
                  .blockSelection.setIndent(1)
              }
            >
              Indent
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                editor
                  .getTransforms(BlockSelectionPlugin)
                  .blockSelection.setIndent(-1)
              }
            >
              Outdent
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Align</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                <ContextMenuItem onClick={() => handleAlign('left')}>
                  Left
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleAlign('center')}>
                  Center
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleAlign('right')}>
                  Right
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
