export interface DashboardRowItem {
  id: string | number;
  title: string;
  image: string;
  onClick: () => void;
  // Optionnels
  mediaType?: 'movie' | 'series';
  overlayText?: string;
  overview?: string;
  progress?: number;
  inWatchlist?: boolean;
  onAddToList?: () => void;
}
