package op

import (
	"errors"
	"testing"

	"github.com/synctv-org/synctv/internal/model"
)

func TestOwnerControlRejectsOtherControllersIncludingAdmins(t *testing.T) {
	r := &Room{Room: model.Room{ID: "room", CreatorID: "owner", Settings: &model.RoomSettings{OwnerControl: true}}}
	for _, role := range []model.Role{model.RoleUser, model.RoleAdmin, model.RoleRoot} {
		u := &User{User: model.User{ID: "viewer", Role: role}}
		for _, permission := range []model.RoomMemberPermission{model.PermissionSetCurrentStatus, model.PermissionSetCurrentMovie} {
			if u.HasRoomPermission(r, permission) {
				t.Fatalf("role %v bypassed owner control", role)
			}
		}
		if _, err := u.SetRoomCurrentStatus(r, true, 100, 1, 0); !errors.Is(err, model.ErrNoPermission) {
			t.Fatalf("status was not denied: %v", err)
		}
		if err := u.SetRoomCurrentMovie(r, "movie", "", true); !errors.Is(err, model.ErrNoPermission) {
			t.Fatalf("movie was not denied: %v", err)
		}
	}
	owner := &User{User: model.User{ID: "owner", Role: model.RoleUser}}
	if !owner.HasRoomPermission(r, model.PermissionSetCurrentStatus) || !owner.HasRoomPermission(r, model.PermissionSetCurrentMovie) {
		t.Fatal("owner lost playback control")
	}
	if r.HasPermission("viewer", model.PermissionSetCurrentStatus) {
		t.Fatal("room check bypassed owner control")
	}
}

func TestOwnerControlDoesNotRemoveChatOrLocalPlaybackChoices(t *testing.T) {
	r := &Room{Room: model.Room{ID: "room", CreatorID: "owner", Settings: &model.RoomSettings{OwnerControl: true, CanSendChatMessage: true, CanGetMovieList: true}}}
	r.members.Store("viewer", &model.RoomMember{UserID: "viewer", Role: model.RoomMemberRoleMember, Permissions: model.DefaultPermissions})
	viewer := &User{User: model.User{ID: "viewer", Role: model.RoleUser}}
	if !viewer.HasRoomPermission(r, model.PermissionSendChatMessage) || !viewer.HasRoomPermission(r, model.PermissionGetMovieList) {
		t.Fatal("viewing or chat permissions changed")
	}
	r.Settings.OwnerControl = false
	root := &User{User: model.User{ID: "root", Role: model.RoleRoot}}
	if !root.HasRoomPermission(r, model.PermissionSetCurrentStatus) {
		t.Fatal("legacy mode must keep admin rights")
	}
	r.members.Store("controller", &model.RoomMember{UserID: "controller", Role: model.RoomMemberRoleMember, Permissions: model.PermissionSetCurrentStatus})
	r.Settings.CanSetCurrentStatus = true
	controller := &User{User: model.User{ID: "controller", Role: model.RoleUser}}
	if !controller.HasRoomPermission(r, model.PermissionSetCurrentStatus) {
		t.Fatal("legacy member control was lost")
	}
}

func TestOnlyOwnerCanChangeModeAndAliasesCannotBypassIt(t *testing.T) {
	r := &Room{Room: model.Room{ID: "room", CreatorID: "owner", Settings: &model.RoomSettings{OwnerControl: true}}}
	root := &User{User: model.User{ID: "root", Role: model.RoleRoot}}
	for _, key := range []string{"owner_control", "OwnerControl", "OWNER_CONTROL"} {
		if err := root.UpdateRoomSettings(r, map[string]any{key: false}); !errors.Is(err, model.ErrNoPermission) {
			t.Fatalf("mode edit via %s was not denied: %v", key, err)
		}
	}
	if err := root.SetRoomSettings(r, &model.RoomSettings{OwnerControl: false}); !errors.Is(err, model.ErrNoPermission) {
		t.Fatal("full settings replacement bypassed owner check")
	}
	owner := &User{User: model.User{ID: "owner", Role: model.RoleUser}}
	if err := owner.UpdateRoomSettings(r, map[string]any{"owner_control": "true"}); err == nil {
		t.Fatal("non-boolean mode accepted")
	}
}
