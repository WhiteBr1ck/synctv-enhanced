package db

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/synctv-org/synctv/internal/conf"
	"github.com/synctv-org/synctv/internal/model"
	"gorm.io/gorm"
)

func TestOwnerControlMigrationAndPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.db")
	connection, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	previous, previousType, previousConf := db, dbType, conf.Conf
	conf.Conf = conf.DefaultConfig()
	conf.Conf.Database.Type = conf.DatabaseTypeSqlite3
	db = connection
	t.Cleanup(func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
		db, dbType, conf.Conf = previous, previousType, previousConf
	})
	// Reproduce an installed upstream database already at the current version.
	// Calling AutoMigrate for RoomSettings here would hide a broken Init path.
	if err := autoMigrate(models...); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.RoomSettings{}, "OwnerControl"); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Setting{Name: "database_version", Type: model.SettingTypeString, Group: model.SettingGroupDatabase, Value: CurrentVersion}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO rooms(id,name,status) VALUES ('existing','existing',3)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO room_settings(id,can_send_chat_message) VALUES ('existing',true)").Error; err != nil {
		t.Fatal(err)
	}
	if err := Init(connection, conf.DatabaseTypeSqlite3); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasColumn(&model.RoomSettings{}, "OwnerControl") {
		t.Fatal("startup did not add owner_control")
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
	if err := Init(db, conf.DatabaseTypeSqlite3); err != nil {
		t.Fatal(err)
	}
	settings, err = CreateOrLoadRoomSettings("existing")
	if err != nil || !settings.OwnerControl {
		t.Fatalf("mode did not survive restart: %v", err)
	}
}
