export interface WallComment { id: string; post_id: string; author_id: string; author_name: string; body: string; created_at: string }
export interface WallPost {
  id: string; challenge_id: string; author_id: string; author_name: string; caption: string; image_url: string | null;
  caring_value: string | null; created_at: string;
  community: { id: string; name: string }; is_member: boolean;
  challenge: { id: string; owner_id: string; visibility: string; title: string; activity_category: string; start_date: string; end_date: string; target_count: number };
  like_count: number; liked_by_me: boolean; comment_count: number; latest_comments: WallComment[];
  participant_count: number; joined_by_me: boolean; owned_by_me: boolean;
}
export interface WallPage { posts: WallPost[]; next_cursor: string | null }
