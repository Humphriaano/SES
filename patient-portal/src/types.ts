export type MetricTag = 'improving' | 'stable' | 'needs-attention';

export interface MetricCard {
  key: string;
  label: string;
  value: string;
  unit: string;
  tag: MetricTag;
  changeText: string;
  recordedAt: string;
}

export interface AppointmentSummary {
  id: string;
  scheduledAt: string;
  clinicianName: string | null;
  clinicName: string;
  status: 'SCHEDULED' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  confirmedVia: 'EMAIL' | 'PORTAL' | null;
}

export interface DashboardData {
  patient: { id: string; name: string; firstName: string };
  metrics: MetricCard[];
  focus: string;
  nextAppointment: AppointmentSummary | null;
  conditions: {
    plainName: string;
    patientStatus: string;
    tip: string | null;
    mythBuster: { myth: string; truth: string } | null;
  }[];
  generatedAt: string;
}

export interface TrendPoint { at: string; value: number; }

export interface TrendMetric {
  key: string;
  label: string;
  unit: string;
  targetRange: { min: number; max: number } | null;
  points: TrendPoint[];
  secondaryPoints?: TrendPoint[];
  sentence: string;
}

export interface Condition {
  plainName: string;
  plainDescription: string | null;
  patientStatus: string;
  firstRecordedAt: string;
  tip: string | null;
  mythBuster: { myth: string; truth: string } | null;
}

export interface Appointment {
  id: string;
  clinicianName: string | null;
  clinicName: string;
  scheduledAt: string;
  status: 'SCHEDULED' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  confirmedAt: string | null;
  confirmedVia: 'EMAIL' | 'PORTAL' | null;
}

export interface CheckInSummary {
  id: string;
  subject: string;
  sentAt: string;
}

export interface CheckInDetail extends CheckInSummary {
  dataSnapshot: DashboardData;
}

export interface PortalSessionInfo {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
}
