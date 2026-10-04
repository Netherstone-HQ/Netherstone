'use client';

import * as React from 'react';

import type { TComboboxInputElement, TMentionElement } from 'platejs';
import type { PlateElementProps } from 'platejs/react';

import { getMentionOnSelectItem } from '@platejs/mention';
import { IS_APPLE, KEYS } from 'platejs';
import {
  PlateElement,
  useFocused,
  useReadOnly,
  useSelected,
} from 'platejs/react';

import {
  flattenShardFiles,
  resolveShardReferencePath,
} from '@/components/sidebar/right-sidebar/link-utils';
import { openEditorFile } from '@/lib/open-editor-file';
import { cn } from '@/lib/utils';
import { isMarkdownPath } from '@/lib/drawing-files';
import { useMounted } from '@/hooks/use-mounted';
import { useVaultStore } from '@/store';
import type { FileTreeNode } from '@/store';

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxInput,
  InlineComboboxItem,
} from './inline-combobox';

export function MentionElement(
  props: PlateElementProps<TMentionElement> & {
    prefix?: string;
  }
) {
  const element = props.element;

  const selected = useSelected();
  const focused = useFocused();
  const mounted = useMounted();
  const readOnly = useReadOnly();

  return (
    <PlateElement
      {...props}
      className={cn(
        'inline-block rounded-md bg-muted px-1.5 py-0.5 align-baseline font-medium text-sm',
        !readOnly && 'cursor-pointer',
        selected && focused && 'ring-2 ring-ring',
        element.children[0][KEYS.bold] === true && 'font-bold',
        element.children[0][KEYS.italic] === true && 'italic',
        element.children[0][KEYS.underline] === true && 'underline'
      )}
      attributes={{
        ...props.attributes,
        contentEditable: false,
        'data-slate-value': element.value,
        draggable: true,
        onClick: () => {
          // Resolved the same way as the right sidebar's shard references.
          const files = flattenShardFiles(useVaultStore.getState().fileTree);
          const path = resolveShardReferencePath(element.value, files);
          if (!path) return;

          void openEditorFile(path).catch((error) => {
            console.error('Failed to open mentioned note:', path, error);
          });
        },
      }}
    >
      {mounted && IS_APPLE ? (
        // Mac OS IME https://github.com/ianstormtaylor/slate/issues/3490
        <>
          {props.children}
          {props.prefix}
          {element.value}
        </>
      ) : (
        // Others like Android https://github.com/ianstormtaylor/slate/pull/5360
        <>
          {props.prefix}
          {element.value}
          {props.children}
        </>
      )}
    </PlateElement>
  );
}

const onSelectItem = getMentionOnSelectItem();

export function MentionInputElement(
  props: PlateElementProps<TComboboxInputElement>
) {
  const { editor, element } = props;
  const [search, setSearch] = React.useState('');

  const shardFiles = useVaultStore((s) => s.fileTree);

  const mentionables = React.useMemo(() => {
    const flatten = (nodes: FileTreeNode[]): FileTreeNode[] => {
      let result: FileTreeNode[] = [];
      for (const node of nodes) {
        if (node.children) {
          result = result.concat(flatten(node.children));
        } else if (isMarkdownPath(node.path)) {
          result.push(node);
        }
      }
      return result;
    };

    return flatten(shardFiles).map((file, index) => ({
      key: `${file.path}-${index}`,
      text: file.name.replace(/\.md$/i, ''),
      path: file.path,
    }));
  }, [shardFiles]);

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        value={search}
        element={element}
        setValue={setSearch}
        showTrigger={false}
        trigger="@"
      >
        <span className="inline-block rounded-md bg-muted px-1.5 py-0.5 align-baseline text-sm ring-ring focus-within:ring-2">
          <InlineComboboxInput />
        </span>

        <InlineComboboxContent className="my-1.5">
          <InlineComboboxEmpty>No results</InlineComboboxEmpty>

          <InlineComboboxGroup>
            {mentionables.map((item) => (
              <InlineComboboxItem
                key={item.key}
                value={item.text}
                onClick={() => onSelectItem(editor, item, search)}
              >
                {item.text}
              </InlineComboboxItem>
            ))}
          </InlineComboboxGroup>
        </InlineComboboxContent>
      </InlineCombobox>

      {props.children}
    </PlateElement>
  );
}

