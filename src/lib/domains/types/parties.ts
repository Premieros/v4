export interface Customer {
  id: string;
  name: string;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  balance: number;
  notes: string | null;
  branch_id: string;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  balance: number;
  notes: string | null;
  branch_id: string;
  created_at: string;
}
