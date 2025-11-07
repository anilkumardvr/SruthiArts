using Microsoft.EntityFrameworkCore;
using SruthiArts.Models;

namespace SruthiArts.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }
        public DbSet<Painting> Paintings => Set<Painting>();
    }
}
