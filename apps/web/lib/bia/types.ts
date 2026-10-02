import type { BiaPlan } from '@oraculo/domain/bia.js';
import type { SortableCell, SortableColumn } from '../../app/components/sortable-table';

export type { BiaPlan };
export type BiaReply = {
  text: string;
  mode: 'local' | 'verified';
  findings?: { label: string; text: string }[];
  explanations?: { label: string; text: string }[];
  scope?: { measure: string; product?: string };
  actions?: { label: string; href: string }[];
  metrics?: { label: string; value: string; caption?: string }[];
  table?: { title: string; columns: SortableColumn[]; rows: SortableCell[][]; initialSort: number };
  source?: { label: string; href: string; period: string; channel: string; updatedAt: string | null; links?: { label: string; href: string }[] };
  notices?: string[];
};
