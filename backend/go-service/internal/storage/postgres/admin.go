package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/admin"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// The methods in this file implement admin.Repository.

const userSelect = `
	SELECT u.id, u.email, u.full_name, m.role, m.active, t.id, t.name, c.id, c.name
	FROM organization_members m
	JOIN users u ON u.id = m.user_id
	LEFT JOIN teams t ON t.id = m.team_id
	LEFT JOIN clients c ON c.id = m.client_id`

func scanUser(row pgx.Row) (admin.User, error) {
	var u admin.User
	var role string
	var teamID, clientID *uuid.UUID
	var teamName, clientName *string
	if err := row.Scan(&u.ID, &u.Email, &u.Name, &role, &u.Active, &teamID, &teamName, &clientID, &clientName); err != nil {
		return admin.User{}, err
	}
	u.Role = domain.Role(role)
	u.Team = ref(teamID, teamName)
	u.Client = ref(clientID, clientName)
	return u, nil
}

func ref(id *uuid.UUID, name *string) *domain.Ref {
	if id == nil || name == nil {
		return nil
	}
	return &domain.Ref{ID: *id, Name: *name}
}

func (s *Store) ListUsers(ctx context.Context, orgID uuid.UUID) ([]admin.User, error) {
	rows, err := s.pool.Query(ctx, userSelect+` WHERE m.organization_id = $1 ORDER BY u.full_name, u.id`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (admin.User, error) { return scanUser(row) })
}

func (s *Store) GetUser(ctx context.Context, orgID, id uuid.UUID) (admin.User, error) {
	u, err := scanUser(s.pool.QueryRow(ctx, userSelect+` WHERE m.organization_id = $1 AND u.id = $2`, orgID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return admin.User{}, domain.ErrNotFound
	}
	if err != nil {
		return admin.User{}, fmt.Errorf("get user: %w", err)
	}
	return u, nil
}

func (s *Store) CreateUser(ctx context.Context, orgID uuid.UUID, in admin.UserInput, passwordHash string) (uuid.UUID, error) {
	id := uuid.New()
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO users (id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)`,
			id, in.Email, passwordHash, in.Name)
		if isUniqueViolation(err) {
			return admin.ErrDuplicate
		}
		if err != nil {
			return fmt.Errorf("insert user: %w", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO organization_members (organization_id, user_id, role, team_id, client_id, active)
			VALUES ($1, $2, $3, $4, $5, TRUE)`, orgID, id, string(in.Role), in.TeamID, in.ClientID)
		if err != nil {
			return fmt.Errorf("insert membership: %w", err)
		}
		return nil
	})
	return id, err
}

func (s *Store) UpdateUser(ctx context.Context, orgID, id uuid.UUID, in admin.UserInput, passwordHash *string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE users SET full_name = $2, password_hash = COALESCE($3, password_hash) WHERE id = $1`,
			id, in.Name, passwordHash); err != nil {
			return fmt.Errorf("update user: %w", err)
		}
		_, err := tx.Exec(ctx, `
			UPDATE organization_members SET role = $3, team_id = $4, client_id = $5, active = $6
			WHERE organization_id = $1 AND user_id = $2`,
			orgID, id, string(in.Role), in.TeamID, in.ClientID, *in.Active)
		if err != nil {
			return fmt.Errorf("update membership: %w", err)
		}
		return nil
	})
}

func (s *Store) TeamExists(ctx context.Context, orgID, teamID uuid.UUID) (bool, error) {
	return s.exists(ctx, `SELECT EXISTS (SELECT 1 FROM teams WHERE id = $1 AND organization_id = $2)`, teamID, orgID)
}

func (s *Store) LeadsTeam(ctx context.Context, orgID, userID uuid.UUID) (bool, error) {
	return s.exists(ctx, `SELECT EXISTS (SELECT 1 FROM teams WHERE wo_user_id = $1 AND organization_id = $2)`, userID, orgID)
}

func (s *Store) IsActiveWO(ctx context.Context, orgID, userID uuid.UUID) (bool, error) {
	return s.exists(ctx, `
		SELECT EXISTS (SELECT 1 FROM organization_members
			WHERE user_id = $1 AND organization_id = $2 AND role = 'wo' AND active)`, userID, orgID)
}

func (s *Store) ListTeams(ctx context.Context, orgID uuid.UUID) ([]admin.Team, error) {
	return s.teams(ctx, orgID, nil)
}

func (s *Store) GetTeam(ctx context.Context, orgID, id uuid.UUID) (admin.Team, error) {
	teams, err := s.teams(ctx, orgID, &id)
	if err != nil {
		return admin.Team{}, err
	}
	if len(teams) == 0 {
		return admin.Team{}, domain.ErrNotFound
	}
	return teams[0], nil
}

// teams loads teams (all, or one) with their WO and active RMs.
func (s *Store) teams(ctx context.Context, orgID uuid.UUID, only *uuid.UUID) ([]admin.Team, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT t.id, t.name, w.id, w.full_name
		FROM teams t
		LEFT JOIN users w ON w.id = t.wo_user_id
		WHERE t.organization_id = $1 AND ($2::uuid IS NULL OR t.id = $2)
		ORDER BY t.name, t.id`, orgID, only)
	if err != nil {
		return nil, fmt.Errorf("list teams: %w", err)
	}
	teams, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (admin.Team, error) {
		var t admin.Team
		var woID *uuid.UUID
		var woName *string
		err := row.Scan(&t.ID, &t.Name, &woID, &woName)
		t.WO = ref(woID, woName)
		t.Members = []domain.Ref{}
		return t, err
	})
	if err != nil {
		return nil, err
	}
	members, err := s.pool.Query(ctx, `
		SELECT m.team_id, u.id, u.full_name
		FROM organization_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.organization_id = $1 AND m.role = 'rm' AND m.active AND m.team_id IS NOT NULL
		ORDER BY u.full_name, u.id`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list team members: %w", err)
	}
	defer members.Close()
	index := map[uuid.UUID]int{}
	for i, t := range teams {
		index[t.ID] = i
	}
	for members.Next() {
		var teamID uuid.UUID
		var r domain.Ref
		if err := members.Scan(&teamID, &r.ID, &r.Name); err != nil {
			return nil, err
		}
		if i, ok := index[teamID]; ok {
			teams[i].Members = append(teams[i].Members, r)
		}
	}
	return teams, members.Err()
}

func (s *Store) CreateTeam(ctx context.Context, orgID uuid.UUID, name string, woUserID uuid.UUID) (uuid.UUID, error) {
	id := uuid.New()
	_, err := s.pool.Exec(ctx, `INSERT INTO teams (id, organization_id, name, wo_user_id) VALUES ($1, $2, $3, $4)`,
		id, orgID, name, woUserID)
	if isUniqueViolation(err) {
		return uuid.Nil, admin.ErrDuplicate
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("insert team: %w", err)
	}
	return id, nil
}

func (s *Store) UpdateTeam(ctx context.Context, orgID, id uuid.UUID, name string, woUserID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE teams SET name = $3, wo_user_id = $4 WHERE id = $2 AND organization_id = $1`,
		orgID, id, name, woUserID)
	if isUniqueViolation(err) {
		return admin.ErrDuplicate
	}
	if err != nil {
		return fmt.Errorf("update team: %w", err)
	}
	return nil
}

func (s *Store) HasQuoteHistory(ctx context.Context, userID uuid.UUID) (bool, error) {
	return s.exists(ctx, `
		SELECT EXISTS (SELECT 1 FROM quotes WHERE created_by = $1)
			OR EXISTS (SELECT 1 FROM quote_events WHERE actor_user_id = $1)`, userID)
}

func (s *Store) DeleteUser(ctx context.Context, orgID, id uuid.UUID) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`, orgID, id); err != nil {
			return fmt.Errorf("delete membership: %w", err)
		}
		_, err := tx.Exec(ctx, `
			DELETE FROM users WHERE id = $1
				AND NOT EXISTS (SELECT 1 FROM organization_members WHERE user_id = $1)`, id)
		if isForeignKeyViolation(err) {
			return admin.ErrInUse
		}
		if err != nil {
			return fmt.Errorf("delete user: %w", err)
		}
		return nil
	})
}

func (s *Store) TeamHasMembers(ctx context.Context, _, teamID uuid.UUID) (bool, error) {
	return s.exists(ctx, `SELECT EXISTS (SELECT 1 FROM organization_members WHERE team_id = $1)`, teamID)
}

func (s *Store) DeleteTeam(ctx context.Context, orgID, id uuid.UUID) error {
	// members.team_id is ON DELETE SET NULL, so no foreign key stops this; re-check emptiness in the same statement.
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM teams t WHERE t.organization_id = $1 AND t.id = $2
			AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.team_id = t.id)`, orgID, id)
	if err != nil {
		return fmt.Errorf("delete team: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return admin.ErrInUse
	}
	return nil
}
