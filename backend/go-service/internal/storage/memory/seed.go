package memory

import (
	"context"

	"github.com/google/uuid"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// Dev fixture IDs, mirrored in db/migrations/V3__seed_dev_login.sql.
var (
	DemoOrgID    = uuid.MustParse("00000000-0000-4000-8000-000000000001")
	DemoUserID   = uuid.MustParse("00000000-0000-4000-8000-000000000002")
	DemoClientID = uuid.MustParse("00000000-0000-4000-8000-000000000003")
)

const (
	DemoEmail    = "demo@swiftquote.dev"
	DemoPassword = "password"
	// bcrypt(cost 10) of DemoPassword.
	demoPasswordHash = "$2a$10$uYfAyrxO7at0lfUCLdJgLu3OcgIQj/se2t21fHhKJV5Sk4vj.0xEG"
)

// Seed loads the demo tenant, login and client.
func (s *Store) Seed() {
	ctx := context.Background()
	_ = s.PutOrganization(ctx, domain.Organization{ID: DemoOrgID, Name: "Demo Co., Ltd.", Slug: "demo", Currency: "THB"})
	_ = s.PutUser(ctx,
		domain.User{ID: DemoUserID, Email: DemoEmail, PasswordHash: demoPasswordHash, FullName: "Demo Owner"},
		domain.Membership{OrganizationID: DemoOrgID, UserID: DemoUserID, Role: domain.RoleOwner},
	)
	_ = s.PutClient(ctx, domain.Client{ID: DemoClientID, OrganizationID: DemoOrgID, Name: "Acme Corporation", Email: "buyer@acme.example"})
}
