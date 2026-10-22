// Package admin manages users and team structure. Only admins may use it.
package admin

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/auth"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// Rules and messages are mirrored by the Spring and Node services.
// Check order: 403 role, 404 target, 400 input, 409 conflicts.

// ErrDuplicate is returned by repositories when a unique email or team name already exists.
var ErrDuplicate = errors.New("duplicate")

// ErrInUse is returned by repositories when a delete hits a foreign key (a row was referenced meanwhile).
var ErrInUse = errors.New("in use")

const minPasswordLength = 8

type User struct {
	ID     uuid.UUID
	Email  string
	Name   string
	Role   domain.Role
	Active bool
	Team   *domain.Ref
	Client *domain.Ref
}

type Team struct {
	ID      uuid.UUID
	Name    string
	WO      *domain.Ref
	Members []domain.Ref
}

// UserInput is the writable part of a user; Password is optional on update.
type UserInput struct {
	Email    string
	Name     string
	Password *string
	Role     domain.Role
	Active   *bool // required on update
	TeamID   *uuid.UUID
	ClientID *uuid.UUID
}

type Repository interface {
	ListUsers(ctx context.Context, orgID uuid.UUID) ([]User, error)
	GetUser(ctx context.Context, orgID, id uuid.UUID) (User, error)
	// CreateUser inserts the user and membership; ErrDuplicate if the email exists.
	CreateUser(ctx context.Context, orgID uuid.UUID, in UserInput, passwordHash string) (uuid.UUID, error)
	// UpdateUser replaces name and membership; a non-nil passwordHash resets the password.
	UpdateUser(ctx context.Context, orgID, id uuid.UUID, in UserInput, passwordHash *string) error
	TeamExists(ctx context.Context, orgID, teamID uuid.UUID) (bool, error)
	ClientExists(ctx context.Context, orgID, clientID uuid.UUID) (bool, error)
	LeadsTeam(ctx context.Context, orgID, userID uuid.UUID) (bool, error)
	IsActiveWO(ctx context.Context, orgID, userID uuid.UUID) (bool, error)
	ListTeams(ctx context.Context, orgID uuid.UUID) ([]Team, error)
	GetTeam(ctx context.Context, orgID, id uuid.UUID) (Team, error)
	// CreateTeam and UpdateTeam return ErrDuplicate for an existing team name.
	CreateTeam(ctx context.Context, orgID uuid.UUID, name string, woUserID uuid.UUID) (uuid.UUID, error)
	UpdateTeam(ctx context.Context, orgID, id uuid.UUID, name string, woUserID uuid.UUID) error
	// HasQuoteHistory reports whether the user created a quote or appears in any quote's history.
	HasQuoteHistory(ctx context.Context, userID uuid.UUID) (bool, error)
	// DeleteUser removes the membership, and the user once no membership is left; ErrInUse on a foreign key.
	DeleteUser(ctx context.Context, orgID, id uuid.UUID) error
	TeamHasMembers(ctx context.Context, orgID, teamID uuid.UUID) (bool, error)
	// DeleteTeam returns ErrInUse if a member was added meanwhile.
	DeleteTeam(ctx context.Context, orgID, id uuid.UUID) error
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func guard(a domain.Actor) error {
	if a.Role != domain.RoleAdmin {
		return domain.ErrRoleForbidden
	}
	return nil
}

func (s *Service) ListUsers(ctx context.Context, a domain.Actor) ([]User, error) {
	if err := guard(a); err != nil {
		return nil, err
	}
	return s.repo.ListUsers(ctx, a.TenantID)
}

func (s *Service) CreateUser(ctx context.Context, a domain.Actor, in UserInput) (User, error) {
	if err := guard(a); err != nil {
		return User{}, err
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	in.Name = strings.TrimSpace(in.Name)
	active := true
	in.Active = &active
	verr := &domain.ValidationError{}
	switch {
	case in.Email == "":
		verr.Add("email is required")
	case !strings.Contains(in.Email, "@"):
		verr.Add("email is not valid")
	}
	if in.Password == nil || len(*in.Password) < minPasswordLength {
		verr.Add(fmt.Sprintf("password must be at least %d characters", minPasswordLength))
	}
	if err := s.checkUser(ctx, a, in, verr); err != nil {
		return User{}, err
	}
	hash, err := auth.HashPassword(*in.Password)
	if err != nil {
		return User{}, err
	}
	id, err := s.repo.CreateUser(ctx, a.TenantID, in, hash)
	if errors.Is(err, ErrDuplicate) {
		return User{}, domain.Conflict(fmt.Sprintf("email %q already exists", in.Email))
	}
	if err != nil {
		return User{}, err
	}
	return s.repo.GetUser(ctx, a.TenantID, id)
}

func (s *Service) UpdateUser(ctx context.Context, a domain.Actor, id uuid.UUID, in UserInput) (User, error) {
	if err := guard(a); err != nil {
		return User{}, err
	}
	current, err := s.repo.GetUser(ctx, a.TenantID, id)
	if errors.Is(err, domain.ErrNotFound) {
		return User{}, domain.NotFound("user not found")
	}
	if err != nil {
		return User{}, err
	}
	in.Email = current.Email
	in.Name = strings.TrimSpace(in.Name)
	verr := &domain.ValidationError{}
	if in.Active == nil {
		verr.Add("active is required")
	}
	active := in.Active != nil && *in.Active
	if in.Password != nil && len(*in.Password) < minPasswordLength {
		verr.Add(fmt.Sprintf("password must be at least %d characters", minPasswordLength))
	}
	if id == a.UserID && (in.Role != domain.RoleAdmin || !active) {
		verr.Add("you cannot change your own role or deactivate yourself")
	}
	if err := s.checkUser(ctx, a, in, verr); err != nil {
		return User{}, err
	}
	if current.Role == domain.RoleWO && (in.Role != domain.RoleWO || !active) {
		leads, err := s.repo.LeadsTeam(ctx, a.TenantID, id)
		if err != nil {
			return User{}, err
		}
		if leads {
			return User{}, domain.Conflict("user leads a team; assign another WO first")
		}
	}
	var hash *string
	if in.Password != nil {
		h, err := auth.HashPassword(*in.Password)
		if err != nil {
			return User{}, err
		}
		hash = &h
	}
	if err := s.repo.UpdateUser(ctx, a.TenantID, id, in, hash); err != nil {
		return User{}, err
	}
	return s.repo.GetUser(ctx, a.TenantID, id)
}

// DeleteUser permanently removes an account nothing refers to; accounts with history are deactivated instead.
func (s *Service) DeleteUser(ctx context.Context, a domain.Actor, id uuid.UUID) error {
	if err := guard(a); err != nil {
		return err
	}
	if _, err := s.repo.GetUser(ctx, a.TenantID, id); errors.Is(err, domain.ErrNotFound) {
		return domain.NotFound("user not found")
	} else if err != nil {
		return err
	}
	if id == a.UserID {
		return domain.Invalid("you cannot delete yourself")
	}
	leads, err := s.repo.LeadsTeam(ctx, a.TenantID, id)
	if err != nil {
		return err
	}
	if leads {
		return domain.Conflict("user leads a team; assign another WO first")
	}
	history, err := s.repo.HasQuoteHistory(ctx, id)
	if err != nil {
		return err
	}
	if history {
		return errUserHasHistory
	}
	if err := s.repo.DeleteUser(ctx, a.TenantID, id); errors.Is(err, ErrInUse) {
		return errUserHasHistory
	} else if err != nil {
		return err
	}
	return nil
}

var errUserHasHistory = domain.Conflict("user has quote history; deactivate instead")

// checkUser validates name, role and placement (team for RMs, client for customers), appending to verr.
func (s *Service) checkUser(ctx context.Context, a domain.Actor, in UserInput, verr *domain.ValidationError) error {
	if in.Name == "" {
		verr.Add("name is required")
	}
	if !in.Role.Valid() {
		verr.Add(fmt.Sprintf("role %q is not a valid Role", in.Role))
	}
	if in.TeamID != nil && in.Role != domain.RoleRM {
		verr.Add("teamId is only allowed for rm")
	}
	if in.Role == domain.RoleCustomer && in.ClientID == nil {
		verr.Add("clientId is required for customer")
	}
	if in.ClientID != nil && in.Role != domain.RoleCustomer {
		verr.Add("clientId is only allowed for customer")
	}
	if err := verr.OrNil(); err != nil {
		return err
	}
	if in.TeamID != nil {
		ok, err := s.repo.TeamExists(ctx, a.TenantID, *in.TeamID)
		if err != nil {
			return err
		}
		if !ok {
			return domain.Invalid("teamId does not exist")
		}
	}
	if in.ClientID != nil {
		ok, err := s.repo.ClientExists(ctx, a.TenantID, *in.ClientID)
		if err != nil {
			return err
		}
		if !ok {
			return domain.Invalid("clientId does not exist")
		}
	}
	return nil
}

func (s *Service) ListTeams(ctx context.Context, a domain.Actor) ([]Team, error) {
	if err := guard(a); err != nil {
		return nil, err
	}
	return s.repo.ListTeams(ctx, a.TenantID)
}

func (s *Service) CreateTeam(ctx context.Context, a domain.Actor, name string, woUserID *uuid.UUID) (Team, error) {
	if err := guard(a); err != nil {
		return Team{}, err
	}
	name, err := s.checkTeam(ctx, a, name, woUserID)
	if err != nil {
		return Team{}, err
	}
	id, err := s.repo.CreateTeam(ctx, a.TenantID, name, *woUserID)
	if errors.Is(err, ErrDuplicate) {
		return Team{}, domain.Conflict(fmt.Sprintf("team %q already exists", name))
	}
	if err != nil {
		return Team{}, err
	}
	return s.repo.GetTeam(ctx, a.TenantID, id)
}

func (s *Service) UpdateTeam(ctx context.Context, a domain.Actor, id uuid.UUID, name string, woUserID *uuid.UUID) (Team, error) {
	if err := guard(a); err != nil {
		return Team{}, err
	}
	if _, err := s.repo.GetTeam(ctx, a.TenantID, id); errors.Is(err, domain.ErrNotFound) {
		return Team{}, domain.NotFound("team not found")
	} else if err != nil {
		return Team{}, err
	}
	name, err := s.checkTeam(ctx, a, name, woUserID)
	if err != nil {
		return Team{}, err
	}
	err = s.repo.UpdateTeam(ctx, a.TenantID, id, name, *woUserID)
	if errors.Is(err, ErrDuplicate) {
		return Team{}, domain.Conflict(fmt.Sprintf("team %q already exists", name))
	}
	if err != nil {
		return Team{}, err
	}
	return s.repo.GetTeam(ctx, a.TenantID, id)
}

func (s *Service) checkTeam(ctx context.Context, a domain.Actor, name string, woUserID *uuid.UUID) (string, error) {
	name = strings.TrimSpace(name)
	verr := &domain.ValidationError{}
	if name == "" {
		verr.Add("name is required")
	}
	if woUserID == nil {
		verr.Add("woUserId is required")
	}
	if err := verr.OrNil(); err != nil {
		return "", err
	}
	ok, err := s.repo.IsActiveWO(ctx, a.TenantID, *woUserID)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", domain.Invalid("woUserId must be an active WO")
	}
	return name, nil
}

// DeleteTeam removes an empty team; members must be moved to another team first.
func (s *Service) DeleteTeam(ctx context.Context, a domain.Actor, id uuid.UUID) error {
	if err := guard(a); err != nil {
		return err
	}
	if _, err := s.repo.GetTeam(ctx, a.TenantID, id); errors.Is(err, domain.ErrNotFound) {
		return domain.NotFound("team not found")
	} else if err != nil {
		return err
	}
	members, err := s.repo.TeamHasMembers(ctx, a.TenantID, id)
	if err != nil {
		return err
	}
	if members {
		return errTeamHasMembers
	}
	if err := s.repo.DeleteTeam(ctx, a.TenantID, id); errors.Is(err, ErrInUse) {
		return errTeamHasMembers
	} else if err != nil {
		return err
	}
	return nil
}

var errTeamHasMembers = domain.Conflict("team has members; move them to another team first")
