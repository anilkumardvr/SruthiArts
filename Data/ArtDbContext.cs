using Microsoft.EntityFrameworkCore;
using SruthiArts.Models;

namespace SruthiArts.Data
{
    public class ArtDbContext : DbContext
    {
        public ArtDbContext(DbContextOptions<ArtDbContext> options) : base(options) {}
        public DbSet<Painting> Paintings => Set<Painting>();
    }
}
