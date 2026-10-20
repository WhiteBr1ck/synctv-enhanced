package db

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/synctv-org/synctv/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestChatHistorySurvivesReopenAndIsolatesRooms(t *testing.T) {
	file := filepath.Join(t.TempDir(), "chat.db")
	open := func() *gorm.DB {
		connection, err := gorm.Open(sqlite.Open(file), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal(err)
		}
		return connection
	}
	previous := db
	db = open()
	t.Cleanup(func() { sqlDB, _ := db.DB(); _ = sqlDB.Close(); db = previous })
	if err := db.AutoMigrate(&model.ChatMessage{}); err != nil {
		t.Fatal(err)
	}
	seed := make([]model.ChatMessage, ChatHistoryLimit)
	for i := range seed {
		seed[i] = model.ChatMessage{RoomID: "first", Timestamp: int64(i), UserID: "user", Username: "viewer", Content: "hello"}
	}
	if err := db.Create(&seed).Error; err != nil {
		t.Fatal(err)
	}
	for i := ChatHistoryLimit; i < ChatHistoryLimit+5; i++ {
		if err := SaveChatMessage(&model.ChatMessage{RoomID: "first", Timestamp: int64(i), UserID: "user", Username: "viewer", Content: "hello"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := SaveChatMessage(&model.ChatMessage{RoomID: "second", Timestamp: 900, Content: "other room"}); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	_ = sqlDB.Close()
	db = open()
	first, err := GetChatHistory("first")
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != ChatHistoryLimit || first[0].Timestamp != 5 || first[len(first)-1].Timestamp != ChatHistoryLimit+4 {
		t.Fatalf("wrong retained history: count=%d", len(first))
	}
	second, err := GetChatHistory("second")
	if err != nil || len(second) != 1 || second[0].Content != "other room" {
		t.Fatalf("room isolation failed: %v", err)
	}
	empty, err := GetChatHistory("empty")
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatal("empty room should return an empty array")
	}
}
