"use client";

import {
  CalendarIcon,
  ChevronRightIcon,
  Code2,
  Columns3Icon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  LightbulbIcon,
  ListIcon,
  ListOrdered,
  PilcrowIcon,
  Quote,
  RadicalIcon,
  Square,
  Table,
  TableOfContentsIcon,
} from "lucide-react";
import * as React from "react";
import { filterWords } from "@platejs/combobox";
import { KEYS, type TComboboxInputElement } from "platejs";
import type { PlateEditor, PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";

import { insertBlock, insertInlineElement } from "@/components/transforms";

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
} from "./inline-combobox";

type Item = {
  icon: React.ReactNode;
  value: string;
  onSelect: (editor: PlateEditor, value: string) => void;
  keywords?: string[];
  label?: string;
};

type Group = {
  group: string;
  items: Item[];
};

const groups: Group[] = [
  {
    group: "Basic blocks",
    items: [
      {
        icon: <PilcrowIcon />,
        keywords: ["paragraph"],
        label: "Text",
        value: KEYS.p,
      },
      {
        icon: <Heading1Icon />,
        keywords: ["title", "h1"],
        label: "Heading 1",
        value: KEYS.h1,
      },
      {
        icon: <Heading2Icon />,
        keywords: ["subtitle", "h2"],
        label: "Heading 2",
        value: KEYS.h2,
      },
      {
        icon: <Heading3Icon />,
        keywords: ["subtitle", "h3"],
        label: "Heading 3",
        value: KEYS.h3,
      },
      {
        icon: <ListIcon />,
        keywords: ["unordered", "ul", "-"],
        label: "Bulleted list",
        value: KEYS.ul,
      },
      {
        icon: <ListOrdered />,
        keywords: ["ordered", "ol", "1"],
        label: "Numbered list",
        value: KEYS.ol,
      },
      {
        icon: <Square />,
        keywords: ["checklist", "task", "checkbox", "[]"],
        label: "To-do list",
        value: KEYS.listTodo,
      },
      {
        icon: <ChevronRightIcon />,
        keywords: ["collapsible", "expandable"],
        label: "Toggle",
        value: KEYS.toggle,
      },
      {
        icon: <Code2 />,
        keywords: ["```"],
        label: "Code block",
        value: KEYS.codeBlock,
      },
      { icon: <Table />, label: "Table", value: KEYS.table },
      {
        icon: <Quote />,
        keywords: ["citation", "blockquote", "quote", ">"],
        label: "Blockquote",
        value: KEYS.blockquote,
      },
      {
        icon: <LightbulbIcon />,
        keywords: ["note"],
        label: "Callout",
        value: KEYS.callout,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor, value) => insertBlock(editor, value, { upsert: true }),
    })),
  },
  {
    group: "Advanced blocks",
    items: [
      {
        icon: <TableOfContentsIcon />,
        keywords: ["toc"],
        label: "Table of contents",
        value: KEYS.toc,
      },
      {
        icon: <Columns3Icon />,
        label: "3 columns",
        value: "action_three_columns",
      },
      { icon: <RadicalIcon />, label: "Equation", value: KEYS.equation },
    ].map((item) => ({
      ...item,
      onSelect: (editor, value) => insertBlock(editor, value, { upsert: true }),
    })),
  },
  {
    group: "Inline",
    items: [
      {
        icon: <CalendarIcon />,
        keywords: ["time"],
        label: "Date",
        value: KEYS.date,
      },
      {
        icon: <RadicalIcon />,
        label: "Inline equation",
        value: KEYS.inlineEquation,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor, value) => insertInlineElement(editor, value),
    })),
  },
];

const allItems = groups.flatMap(({ items }) => items);

// Lower is better: the name starts with the search, then a word in the name
// does, then any other search word matches. -1 means no match.
function matchRank({ keywords = [], label, value }: Item, search: string) {
  const name = (label ?? value).toLowerCase();

  if (name.startsWith(search)) return 0;
  if (name.split(/\s+/).some((word) => word.startsWith(search))) return 1;
  if (
    [value, ...keywords, label].some(
      (term) => term && filterWords(term, search),
    )
  ) {
    return 2;
  }

  return -1;
}

// While typing, one list with the best match first (and picked by Enter).
function rankItems(search: string) {
  return allItems
    .map((item) => ({ item, rank: matchRank(item, search) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

export function SlashInputElement(
  props: PlateElementProps<TComboboxInputElement>,
) {
  const { editor, element } = props;
  const [value, setValue] = React.useState("");
  const search = value.trim().toLowerCase();

  const renderItem = ({ icon, label, value, onSelect }: Item) => (
    <InlineComboboxItem
      key={value}
      onClick={() => onSelect(editor, value)}
      value={value}
    >
      <div className="mr-2 text-muted-foreground">{icon}</div>
      {label ?? value}
    </InlineComboboxItem>
  );

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        element={element}
        filter={false}
        setValue={setValue}
        trigger="/"
        value={value}
      >
        <InlineComboboxInput />

        <InlineComboboxContent>
          <InlineComboboxEmpty>No results</InlineComboboxEmpty>

          {search
            ? rankItems(search).map(renderItem)
            : groups.map(({ group, items }) => (
                <InlineComboboxGroup key={group}>
                  <InlineComboboxGroupLabel>{group}</InlineComboboxGroupLabel>
                  {items.map(renderItem)}
                </InlineComboboxGroup>
              ))}
        </InlineComboboxContent>
      </InlineCombobox>

      {props.children}
    </PlateElement>
  );
}
