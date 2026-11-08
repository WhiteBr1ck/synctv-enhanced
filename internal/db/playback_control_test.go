package db

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/synctv-org/synctv/internal/model"
	"gorm.io/gorm"
)

func TestOwnerControlMigrationAndPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.db")
	connection, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	previous := db
	db = connection
	t.Cleanup(func() { sqlDB, _ := db.DB(); _ = sqlDB.Close(); db = previous })
	if err := db.Exec("CREATE TABLE room_settings (id text PRIMARY KEY, can_send_chat_message numeric DEFAULT true)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO room_settings(id,can_send_chat_message) VALUES ('existing',true)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.RoomSettings{}); err != nil {
		t.Fatal(err)
	}
	settings, err := CreateOrLoadRoomSettings("existing")
	if err != nil || settings.OwnerControl || !settings.CanSendChatMessage {
		t.Fatalf("migration changed old room: %+v %v", settings, err)
	}
	settings, err = UpdateRoomSettings("existing", map[string]any{"owner_control": true})
	if err != nil || !settings.OwnerControl {
		t.Fatalf("mode update failed: %v", err)
	}
	sqlDB, _ := db.DB()
	_ = sqlDB.Close()
	db, err = gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	settings, err = CreateOrLoadRoomSettings("existing")
	if err != nil || !settings.OwnerControl {
		t.Fatalf("mode did not survive restart: %v", err)
	}
}
