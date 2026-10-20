package model

// ChatMessage is stored separately from playback and room membership state.
type ChatMessage struct {
	ID        uint64 `gorm:"primaryKey;autoIncrement" json:"id"`
	RoomID    string `gorm:"not null;type:char(32);index:idx_chat_room_id,priority:1" json:"-"`
	Timestamp int64  `gorm:"not null" json:"timestamp"`
	UserID    string `gorm:"type:char(32)" json:"userId"`
	Username  string `gorm:"type:varchar(32)" json:"username"`
	Content   string `gorm:"type:text;not null" json:"content"`
}
