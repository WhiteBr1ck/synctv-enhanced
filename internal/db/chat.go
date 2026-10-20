package db

import (
	"slices"

	"github.com/synctv-org/synctv/internal/model"
	"gorm.io/gorm"
)

const ChatHistoryLimit = 500

func SaveChatMessage(message *model.ChatMessage) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(message).Error; err != nil {
			return err
		}
		var oldest model.ChatMessage
		result := tx.Where("room_id = ?", message.RoomID).Order("id DESC").Offset(ChatHistoryLimit - 1).Limit(1).Find(&oldest)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		return tx.Where("room_id = ? AND id < ?", message.RoomID, oldest.ID).Delete(&model.ChatMessage{}).Error
	})
}

func GetChatHistory(roomID string) ([]*model.ChatMessage, error) {
	messages := make([]*model.ChatMessage, 0)
	err := db.Where("room_id = ?", roomID).Order("id DESC").Limit(ChatHistoryLimit).Find(&messages).Error
	slices.Reverse(messages)
	return messages, err
}
